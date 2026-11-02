// The historical role code is retained; a grant alone never proves department responsibility.
const { activeActor } = require('./processV7Authoring');
const { ACCESS_MODEL_VERSION } = require('./roleDefinitions');
const { identityInteger, sameIdentityInteger, sessionSubject } = require('./sessionSubject');
const POLICY_VERSION = 'department-accountability-v1';
const POLICY_MIGRATION_KEY = '2026-10-19-department-accountability-v1';
const POLICY_BACKUP_TABLE = 'department_accountability_policy_backups';
const ROLE_CODE = 'department_mdm_reviewer';
const ROLE_NAME = '部门负责人';
const ROLE_DESCRIPTION = '由部门最终负责人本人核对本部门流程事实并作出最终确认，不设置中间审核员或代记录决定';
const requiredPermissions = ['governance:review-department', 'governance:record-department-decision'];
const unavailable = error => ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error && error.code);
const id = value => { const exact = identityInteger(value); return exact == null ? null : String(exact); };
async function one(db, sql, params = []) { return (await db.execute(sql, params))[0][0] || null; }
function failure(reason) {
  const statusCode = reason === 'DEPARTMENT_ACCOUNTABILITY_POLICY_REQUIRED' ? 503 : 403;
  return Object.assign(new Error(reason === 'DEPARTMENT_FINAL_RESPONSIBLE_UNSET' ? '部门最终负责人尚未明确，不能代为确认' : '当前人员、部门负责人登记与有效授权不一致，不能确认部门决定'), {
    code: reason, statusCode, payload: { code: reason, error: reason === 'DEPARTMENT_ACCOUNTABILITY_POLICY_REQUIRED' ? '部门负责人确认规则尚未准备' : '须由已登记且具有本部门有效授权的部门负责人本人核对并最终确认' }
  });
}
async function policyState(db, { lock = false } = {}) {
  try {
    const marker = await one(db, `SELECT migration_key FROM schema_migrations WHERE migration_key=? ${lock ? 'FOR SHARE' : ''}`, [POLICY_MIGRATION_KEY]);
    if (!marker) return { ready: false };
    const backup = await one(db, `SELECT snapshot_json,status FROM ${POLICY_BACKUP_TABLE} WHERE migration_key=? ${lock ? 'FOR SHARE' : ''}`, [POLICY_MIGRATION_KEY]);
    if (!backup || backup.status !== 'applied') return { ready: false };
    const snapshot = JSON.parse(backup.snapshot_json);
    return { ready: snapshot.policy_version === POLICY_VERSION, snapshot };
  } catch (error) { if (unavailable(error) || error instanceof SyntaxError) return { ready: false }; throw error; }
}
async function readDepartmentAppointment(db, departmentId, { lock = false } = {}) {
  const event = await one(db, `SELECT CAST(event_id AS CHAR) event_id,
    JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.departmentAppointment.decisionRecordCutoff')) decision_record_cutoff
    FROM identity_access_events WHERE event_type='role_assigned'
      AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.roleCode'))=?
      AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.departmentAppointment.departmentId'))=?
      AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.departmentAppointment.changed'))='true'
    ORDER BY event_id DESC LIMIT 1 ${lock ? 'FOR SHARE' : ''}`, [ROLE_CODE, id(departmentId)]);
  return event ? { appointment_event_id: id(event.event_id), decision_record_cutoff: event.decision_record_cutoff } : { appointment_event_id: null, decision_record_cutoff: null };
}
async function inspectDepartmentAccountability(db, actor, departmentId, { lock = false } = {}) {
  const result = { eligible: false, reason: null, policy_version: POLICY_VERSION, department_id: id(departmentId),
    actor_person_id: id(actor && actor.personId), final_responsible_person_id: null, role_assignment_id: null, appointment_event_id: null };
  const deny = reason => ({ ...result, reason });
  if (!(await policyState(db, { lock })).ready) return deny('DEPARTMENT_ACCOUNTABILITY_POLICY_REQUIRED');
  const department = result.department_id && await one(db, `SELECT CAST(id AS CHAR) id,status,CAST(final_responsible_person_id AS CHAR) final_responsible_person_id
    FROM departments WHERE id=CAST(? AS SIGNED) ${lock ? 'FOR SHARE' : ''}`, [result.department_id]);
  if (!department || department.status !== 'active') return deny('DEPARTMENT_INACTIVE');
  result.final_responsible_person_id = id(department.final_responsible_person_id);
  if (!result.final_responsible_person_id) return deny('DEPARTMENT_FINAL_RESPONSIBLE_UNSET');
  if (sessionSubject(actor || {}).kind === 'system_admin') return deny('DEPARTMENT_ACCOUNTABILITY_ADMIN_READ_ONLY');
  let current;
  try { current = await activeActor(db, actor || {}, lock); }
  catch (error) { if (error.code === 'SESSION_AUTHORIZATION_CHANGED') return deny('DEPARTMENT_ACCOUNTABILITY_ACTOR_INACTIVE'); throw error; }
  if (current.admin) return deny('DEPARTMENT_ACCOUNTABILITY_ADMIN_READ_ONLY');
  if (!sameIdentityInteger(current.current_department_id, result.department_id)) return deny('DEPARTMENT_PERSON_SCOPE_MISMATCH');
  if (!sameIdentityInteger(current.person_id, result.final_responsible_person_id)) return deny('DEPARTMENT_FINAL_RESPONSIBLE_MISMATCH');
  const assignment = await one(db, `SELECT CAST(pr.person_role_id AS CHAR) person_role_id FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id
    WHERE pr.person_id=CAST(? AS SIGNED) AND r.role_code=? AND r.status='active' AND r.model_version=?
      AND pr.assignment_status='active' AND pr.scope_type='department' AND pr.scope_department_id=CAST(? AS SIGNED)
      AND pr.effective_from IS NOT NULL AND pr.effective_from<=CURRENT_DATE AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
    ORDER BY pr.person_role_id LIMIT 1 ${lock ? 'FOR SHARE' : ''}`, [result.actor_person_id, ROLE_CODE, ACCESS_MODEL_VERSION, result.department_id]);
  if (!assignment) return deny('DEPARTMENT_ACCOUNTABILITY_ROLE_REQUIRED');
  result.role_assignment_id = id(assignment.person_role_id);
  const scoped = current.grants.filter(grant => grant.role_code === ROLE_CODE && grant.scope_type === 'department' && sameIdentityInteger(grant.scope_department_id, result.department_id));
  if (!requiredPermissions.every(code => current.effects.get(code) === 'allow' && scoped.some(grant => grant.perm_code === code && grant.effect === 'allow') && !scoped.some(grant => grant.perm_code === code && grant.effect === 'deny'))) return deny('DEPARTMENT_ACCOUNTABILITY_PERMISSION_REQUIRED');
  result.appointment_event_id = (await readDepartmentAppointment(db, result.department_id, { lock })).appointment_event_id;
  return { ...result, eligible: true };
}
async function assertDepartmentAccountability(db, actor, departmentId, options = {}) {
  const result = await inspectDepartmentAccountability(db, actor, departmentId, { ...options, lock: options.lock !== false });
  if (!result.eligible) throw failure(result.reason);
  return result;
}
async function canConfirmDepartment(db, actor, departmentId, options = {}) {
  return (await inspectDepartmentAccountability(db, actor, departmentId, options)).eligible;
}
function sourceBinding({ sourceRevision, sourceHash } = {}) {
  const revision = Number(sourceRevision), hash = String(sourceHash || '');
  return Number.isSafeInteger(revision) && revision > 0 && /^[a-f0-9]{64}$/i.test(hash) ? { source_revision: revision, source_hash: hash.toLowerCase() } : null;
}
function decisionEvidence(authority, source) {
  const binding = sourceBinding(source);
  if (!authority || !authority.eligible || authority.policy_version !== POLICY_VERSION || !binding || !sameIdentityInteger(authority.actor_person_id, authority.final_responsible_person_id)) throw failure('DEPARTMENT_ACCOUNTABILITY_EVIDENCE_INVALID');
  return { policy_version: POLICY_VERSION, department_id: id(authority.department_id), confirmed_by_person_id: id(authority.actor_person_id),
    accountable_person_id: id(authority.final_responsible_person_id), role_assignment_id: id(authority.role_assignment_id),
    appointment_event_id: id(authority.appointment_event_id), ...binding };
}
function isCurrentDepartmentDecision(evidence, { departmentId, personId, sourceRevision, sourceHash } = {}) {
  const binding = sourceBinding({ sourceRevision, sourceHash });
  return Boolean(evidence && evidence.policy_version === POLICY_VERSION && binding && id(evidence.role_assignment_id) &&
    sameIdentityInteger(evidence.department_id, departmentId) && sameIdentityInteger(evidence.confirmed_by_person_id, personId) &&
    sameIdentityInteger(evidence.accountable_person_id, personId) && Number(evidence.source_revision) === binding.source_revision && evidence.source_hash === binding.source_hash);
}
async function inspectCurrentDepartmentDecision(db, departmentId, evidence, { sourceRevision, sourceHash, lock = false } = {}) {
  if (!isCurrentDepartmentDecision(evidence, { departmentId, personId: evidence && evidence.confirmed_by_person_id, sourceRevision, sourceHash })) return { valid: false, reason: 'DEPARTMENT_ACCOUNTABILITY_EVIDENCE_INVALID', authority: null };
  const account = await one(db, `SELECT CAST(account_id AS CHAR) account_id,CAST(auth_version AS CHAR) auth_version FROM user_accounts WHERE person_id=CAST(? AS SIGNED) ${lock ? 'FOR SHARE' : ''}`, [id(evidence.confirmed_by_person_id)]);
  if (!account) return { valid: false, reason: 'DEPARTMENT_ACCOUNTABILITY_ACTOR_INACTIVE', authority: null };
  const authority = await inspectDepartmentAccountability(db, { personId: evidence.confirmed_by_person_id, accountId: account.account_id, authVersion: account.auth_version }, departmentId, { lock });
  if (!authority.eligible) return { valid: false, reason: authority.reason, authority };
  if (!sameIdentityInteger(authority.role_assignment_id, evidence.role_assignment_id)) return { valid: false, reason: 'DEPARTMENT_ACCOUNTABILITY_ASSIGNMENT_CHANGED', authority };
  // A -> B -> A must not revive A's earlier decision, even when A's original
  // role row is preserved. Account/session changes are unrelated to this term.
  if ((evidence.appointment_event_id != null && !id(evidence.appointment_event_id)) ||
      id(authority.appointment_event_id) !== id(evidence.appointment_event_id)) return { valid: false, reason: 'DEPARTMENT_ACCOUNTABILITY_APPOINTMENT_CHANGED', authority };
  return { valid: true, reason: null, authority };
}
async function isPostPolicyDecision(db, decisionRecordId) {
  const state = await policyState(db);
  const value = id(decisionRecordId), cutoff = state.snapshot && state.snapshot.cutoffs && state.snapshot.cutoffs.governance_decision_records;
  return Boolean(state.ready && value && cutoff != null && /^\d+$/.test(String(cutoff)) && BigInt(value) > BigInt(cutoff));
}
async function isPostAppointmentDecision(db, departmentId, decisionRecordId) {
  const value = id(decisionRecordId), appointment = await readDepartmentAppointment(db, departmentId);
  if (!value) return false;
  if (!appointment.appointment_event_id) return true;
  const cutoff = appointment.decision_record_cutoff;
  return cutoff != null && /^\d+$/.test(String(cutoff)) && BigInt(value) > BigInt(cutoff);
}
module.exports = { POLICY_VERSION, POLICY_MIGRATION_KEY, POLICY_BACKUP_TABLE, ROLE_CODE, ROLE_NAME, ROLE_DESCRIPTION,
  policyState, inspectDepartmentAccountability, assertDepartmentAccountability, canConfirmDepartment,
  decisionEvidence, isCurrentDepartmentDecision, inspectCurrentDepartmentDecision, isPostPolicyDecision,
  readDepartmentAppointment, isPostAppointmentDecision };
