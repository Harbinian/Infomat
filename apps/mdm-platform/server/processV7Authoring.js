const crypto = require('node:crypto');
const { ACCESS_MODEL_VERSION } = require('./roleDefinitions');
const { failure } = require('./processV7AuthoringMigration');
const enabled = () => process.env.PROCESS_V7_AUTHORING_ENABLED === '1';
const coordinated = new Set(['message', 'supplement_request', 'reminder']);
const authored = new Set(['fact_note', 'problem_reply', 'governance_suggestion']);
async function state(db, caseId, lock = false) {
  try {
    const [[row]] = await db.execute(`SELECT a.*, p.person_name AS compiler_name,
      UNIX_TIMESTAMP(a.started_at) AS started_epoch
      FROM process_v7_authoring a LEFT JOIN person p ON p.person_id=a.compiler_person_id
      WHERE a.case_id=? ${lock ? 'FOR UPDATE' : ''}`, [caseId]);
    return row ? { ...row, compiler_person_id: row.compiler_person_id == null ? null : String(row.compiler_person_id),
      started_at: row.started_epoch == null ? null : new Date(Number(row.started_epoch) * 1000).toISOString(), started_epoch: undefined } : null;
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE' && !enabled()) return null;
    if (error.code === 'ER_NO_SUCH_TABLE') throw failure('V7_AUTHORING_SCHEMA_UNAVAILABLE', 503);
    throw error;
  }
}
async function activeActor(db, actor, lock = true) {
  const [[account]] = await db.execute(`SELECT ua.account_id, ua.auth_version, p.person_id, p.current_department_id
    FROM user_accounts ua JOIN person p ON p.person_id=ua.person_id
    JOIN departments d ON d.id=p.current_department_id
    WHERE ua.account_id=? AND ua.person_id=? AND ua.account_status='active' AND ua.must_change_password=0
      AND p.status='active' AND p.employment_status='active' AND d.status='active' ${lock ? 'FOR SHARE' : ''}`, [actor.accountId || 0, actor.personId || 0]);
  if (!account || Number(account.auth_version) !== Number(actor.authVersion)) throw failure('SESSION_AUTHORIZATION_CHANGED', 401);
  const [grants] = await db.execute(`SELECT r.role_code, pr.scope_type, pr.scope_department_id, permission.perm_code, rp.effect
    FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id
    LEFT JOIN role_permissions rp ON rp.role_id=r.role_id LEFT JOIN permissions permission ON permission.perm_id=rp.perm_id
    WHERE pr.person_id=? AND pr.assignment_status='active' AND pr.authorization_basis IS NOT NULL
      AND pr.effective_from IS NOT NULL AND pr.effective_from<=CURRENT_DATE
      AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
      AND r.status='active' AND r.model_version=? ${lock ? 'FOR SHARE' : ''}`, [actor.personId, ACCESS_MODEL_VERSION]);
  const effects = new Map();
  for (const g of grants) if (g.perm_code && (g.effect === 'deny' || !effects.has(g.perm_code))) effects.set(g.perm_code, g.effect);
  return { ...account, grants, admin: grants.some(g => g.role_code === 'admin'), effects };
}
function isContact(current, caseRow) {
  return !current.admin && Number(current.current_department_id) === Number(caseRow.owning_department_id) &&
    current.effects.get('governance:draft-department') === 'allow' && current.grants.some(g => g.role_code === 'department_contact' && g.scope_type === 'department' && Number(g.scope_department_id) === Number(caseRow.owning_department_id));
}
function isCompiler(current, caseRow, binding) {
  return !current.admin && current.effects.get('governance:draft-department') !== 'deny' && binding && String(current.person_id) === String(binding.compiler_person_id) && Number(current.current_department_id) === Number(caseRow.owning_department_id);
}
async function initialize(db, caseRow, actor) {
  if (!enabled()) return;
  const current = await activeActor(db, actor);
  await db.execute('INSERT INTO process_v7_authoring(case_id,compiler_person_id) VALUES (?,?)', [caseRow.id, isContact(current, caseRow) ? actor.personId : null]);
}
// Caller must already hold the case FOR UPDATE lock, including formal submit callers.
async function assertCompiler(db, caseRow, actor, { start = false } = {}) {
  const binding = await state(db, caseRow.id, true);
  if (!binding) return false; // supported legacy case; no inferred assignment or transfer window
  if (!enabled()) throw failure('V7_AUTHORING_DISABLED', 503); // disabling never restores former contact write access
  if (caseRow.status === 'closed') throw failure('V7_AUTHORING_CASE_CLOSED');
  const current = await activeActor(db, actor);
  if (!isCompiler(current, caseRow, binding)) throw failure('V7_AUTHORING_COMPILER_REQUIRED', 403);
  if (start) await markStarted(db, caseRow.id);
  return true;
}
async function markStarted(db, caseId) {
  await db.execute('UPDATE process_v7_authoring SET started_at=CURRENT_TIMESTAMP, assignment_version=assignment_version+1 WHERE case_id=? AND started_at IS NULL', [caseId]);
}
async function canReadAssigned(db, caseId, actor) {
  const binding = await state(db, caseId);
  if (!binding || String(binding.compiler_person_id) !== String(actor.personId)) return false;
  const [[row]] = await db.execute('SELECT owning_department_id FROM process_v7_preview_cases WHERE id=?', [caseId]);
  const current = await activeActor(db, actor);
  return row && isCompiler(current, row, binding);
}
async function candidates(db, caseRow, actor) {
  const current = await activeActor(db, actor);
  if (!enabled() || !isContact(current, caseRow)) throw failure('V7_AUTHORING_SCOPE_DENIED', 403);
  const binding = await state(db, caseRow.id);
  if (!binding || binding.started_at || caseRow.status === 'closed') throw failure('V7_AUTHORING_TRANSFER_CLOSED');
  const [items] = await db.execute(`SELECT p.person_id, p.employee_no, p.person_name,
    EXISTS(SELECT 1 FROM user_accounts ua WHERE ua.person_id=p.person_id AND ua.account_status='active') AS login_available
    FROM person p WHERE p.current_department_id=? AND p.status='active' AND p.employment_status='active'
      AND NOT EXISTS(SELECT 1 FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id WHERE pr.person_id=p.person_id
        AND r.role_code='admin' AND r.status='active' AND pr.assignment_status='active'
        AND pr.authorization_basis IS NOT NULL AND pr.effective_from<=CURRENT_DATE
        AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)) ORDER BY p.person_id LIMIT 201`, [caseRow.owning_department_id]);
  return { items: items.slice(0, 200).map(p => ({ ...p, person_id: String(p.person_id), login_available: Boolean(p.login_available) })), truncated: items.length > 200 };
}
async function describe(db, caseRow, actor) {
  const binding = await state(db, caseRow.id);
  if (!binding) return { managed: false, transfer_available: false, reason: 'legacy_history_unestablished', records: [] };
  const current = await activeActor(db, actor);
  const compiler = isCompiler(current, caseRow, binding), contact = isContact(current, caseRow);
  const [records] = await db.execute(`SELECT r.id,r.request_key,r.record_kind,r.content_text,r.actor_person_id,p.person_name AS actor_name,
    r.recipient_person_id,r.revision_no,r.content_hash,r.assignment_version,UNIX_TIMESTAMP(r.created_at) AS created_epoch
    FROM process_v7_authoring_records r JOIN person p ON p.person_id=r.actor_person_id WHERE r.case_id=? ORDER BY r.id DESC LIMIT 200`, [caseRow.id]);
  return { ...binding, managed: true, is_compiler: compiler, transfer_available: enabled() && contact && !binding.started_at && caseRow.status !== 'closed',
    can_coordinate: enabled() && contact && caseRow.status !== 'closed', can_record: enabled() && compiler && caseRow.status !== 'closed',
    records: records.map(r => ({ ...r, id: String(r.id), actor_person_id: String(r.actor_person_id), recipient_person_id: r.recipient_person_id == null ? null : String(r.recipient_person_id), created_at: new Date(Number(r.created_epoch) * 1000).toISOString(), created_epoch: undefined })), record_limit: 200 };
}
async function record(db, caseRow, body, actor, reference = null) {
  if (!enabled()) throw failure('V7_AUTHORING_DISABLED', 503);
  const current = await activeActor(db, actor), binding = await state(db, caseRow.id, true);
  if (!binding) throw failure('V7_AUTHORING_LEGACY_UNASSIGNED');
  if (caseRow.status === 'closed') throw failure('V7_AUTHORING_CASE_CLOSED');
  const kind = String(body.record_kind || ''), content = String(body.content || '').trim(), key = String(body.request_key || '');
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(key) || !content || content.length > 4000 || ![...coordinated, ...authored, 'transfer'].includes(kind)) throw failure('V7_AUTHORING_INPUT_INVALID', 422);
  if (kind === 'transfer' || coordinated.has(kind)) {
    if (!isContact(current, caseRow)) throw failure('V7_AUTHORING_SCOPE_DENIED', 403);
  } else if (!isCompiler(current, caseRow, binding)) throw failure('V7_AUTHORING_COMPILER_REQUIRED', 403);
  const hash = crypto.createHash('sha256').update(JSON.stringify({ actor_person_id: String(actor.personId), record_kind: kind, content, recipient_person_id: String(body.recipient_person_id || ''), expected_revision_no: body.expected_revision_no, expected_content_hash: body.expected_content_hash, expected_assignment_version: body.expected_assignment_version, ...(reference ? { reference } : {}) })).digest('hex');
  const [[prior]] = await db.execute('SELECT CAST(id AS CHAR) id,request_hash FROM process_v7_authoring_records WHERE case_id=? AND request_key=? FOR UPDATE', [caseRow.id, key]);
  if (prior) {
    if (prior.request_hash !== hash) throw failure('V7_AUTHORING_IDEMPOTENCY_CONFLICT');
    return { idempotent: true, record_id: prior.id };
  }
  if (Number(body.expected_assignment_version) !== Number(binding.assignment_version)) throw failure('V7_AUTHORING_ASSIGNMENT_CHANGED');
  let recipient = binding.compiler_person_id;
  if (kind === 'transfer') {
    if (binding.started_at) throw failure('V7_AUTHORING_TRANSFER_CLOSED');
    const id = String(body.recipient_person_id || '');
    if (!/^[1-9]\d*$/.test(id)) throw failure('V7_AUTHORING_RECIPIENT_INVALID', 422);
    const [[p]] = await db.execute(`SELECT person_id FROM person WHERE person_id=? AND current_department_id=? AND status='active' AND employment_status='active' FOR SHARE`, [id, caseRow.owning_department_id]);
    const [admins] = await db.execute(`SELECT pr.person_role_id FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id WHERE pr.person_id=? AND r.role_code='admin'
      AND r.status='active' AND pr.assignment_status='active' AND pr.authorization_basis IS NOT NULL
      AND pr.effective_from<=CURRENT_DATE AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE) FOR SHARE`, [id]);
    if (!p || admins.length) throw failure('V7_AUTHORING_RECIPIENT_INVALID', 422);
    recipient = id;
    await db.execute('UPDATE process_v7_authoring SET compiler_person_id=?, assignment_version=assignment_version+1 WHERE case_id=?', [id, caseRow.id]);
  } else if (authored.has(kind)) await markStarted(db, caseRow.id);
  else if (!recipient) throw failure('V7_AUTHORING_COMPILER_UNASSIGNED');
  await db.execute(`INSERT INTO process_v7_authoring_records(case_id,request_key,request_hash,record_kind,content_text,actor_person_id,recipient_person_id,revision_no,content_hash,assignment_version)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [caseRow.id, key, hash, kind, content, actor.personId, recipient, caseRow.current_revision_no, caseRow.current_content_hash, binding.assignment_version]);
  const [[inserted]] = await db.execute('SELECT CAST(LAST_INSERT_ID() AS CHAR) id');
  return { idempotent: false, record_id: inserted.id };
}
module.exports = { enabled, state, activeActor, isContact, isCompiler, initialize, assertCompiler, markStarted, canReadAssigned, candidates, describe, record };
