// Explicit assignments supplement fixed roles; absent legacy assignments grant nothing.
const crypto = require('node:crypto');
const { identityInteger, sameIdentityInteger, sessionSubject } = require('./sessionSubject');
const { activeActor } = require('./processV7Authoring');
const { ACCESS_MODEL_VERSION } = require('./roleDefinitions');
const { withMysqlTransactionDeadline } = require('./boundedMysql');
const { assertV7PreviewEnabled } = require('./processV7TrialScope');
const { assertProcessDataGovernanceEnabled, assertProcessDataGovernanceWritable, isProcessDataGovernanceEnabled, isProcessDataGovernanceReadOnly } = require('./processDataGovernanceScope');
const RESPONSIBILITIES_MIGRATION_KEY = '2026-10-19-governance-responsibilities-v1';

const text = value => String(value == null ? '' : value).trim();
function fail(code, message, statusCode = 409) { return Object.assign(new Error(message), { code, statusCode, payload: { code, error: message } }); }
function migrationError(error) {
  if (error && ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error.code)) return fail('RESPONSIBILITY_MIGRATION_REQUIRED', '治理职责结构尚未准备，请先完成受控迁移', 503);
  return error;
}
async function rows(db, sql, params = []) { const [result] = await db.execute(sql, params); return result; }
async function one(db, sql, params = []) { return (await rows(db, sql, params))[0] || null; }
function assertResponsibilityScope(type, { write = false } = {}) {
  if (type === 'case') return assertV7PreviewEnabled();
  if (type !== 'work_package') throw fail('RESPONSIBILITY_TARGET_INVALID', '职责事项类型无效', 422);
  assertProcessDataGovernanceEnabled();
  if (write) assertProcessDataGovernanceWritable();
  else isProcessDataGovernanceReadOnly();
}
function retainedPackageReadable(type, row) {
  if (type === 'work_package' && isProcessDataGovernanceReadOnly() && row.status !== 'completed') {
    throw fail('PROCESS_DATA_GOVERNANCE_COMPLETED_ONLY', '本批结束后的查阅仅保留已完成治理工作包', 403);
  }
}
function exactId(value) {
  const id = identityInteger(value);
  if (!id) throw fail('RESPONSIBILITY_ID_INVALID', '人员或事项标识无效', 422);
  return String(id);
}
function role(current, code) { return current.grants.some(item => item.role_code === code); }
function lead(current) { return !current.admin && role(current, 'mdm_lead') && current.effects.get('governance:assign-work') === 'allow'; }
function steward(current) { return !current.admin && role(current, 'mdm_steward') && current.effects.get('governance:handle-assigned-work') === 'allow' && current.effects.get('governance:read-assigned-context') === 'allow'; }
function normalized(row) {
  if (!row) return null;
  const result = { ...row, revision_no: Number(row.revision_no) };
  for (const field of ['id', 'target_id', 'person_id', 'department_id', 'actor_person_id', 'previous_person_id']) if (field in result) result[field] = result[field] == null ? null : String(result[field]);
  return result;
}
async function requirePrepared(db, lock = false) {
  const marker = await one(db, `SELECT migration_key FROM schema_migrations WHERE migration_key=? ${lock ? 'FOR SHARE' : ''}`, [RESPONSIBILITIES_MIGRATION_KEY]);
  if (!marker) throw fail('RESPONSIBILITY_MIGRATION_REQUIRED', '治理职责迁移尚未完成，请先完成受控准备', 503);
}
async function assignment(db, type, id, kind, lock = false) {
  await requirePrepared(db, lock);
  return normalized(await one(db, `SELECT a.*, CAST(a.target_id AS CHAR) AS target_id, CAST(a.person_id AS CHAR) AS person_id,
    CAST(a.department_id AS CHAR) AS department_id, CAST(a.actor_person_id AS CHAR) AS actor_person_id, p.person_name
    FROM process_governance_responsibilities a LEFT JOIN person p ON p.person_id=a.person_id
    WHERE a.target_type=? AND a.target_id=CAST(? AS SIGNED) AND a.assignment_kind=? ${lock ? 'FOR UPDATE' : ''}`, [type, exactId(id), kind]));
}
async function target(db, type, id, lock = false) {
  assertResponsibilityScope(type, { write: lock });
  id = exactId(id);
  if (!['case', 'work_package'].includes(type)) throw fail('RESPONSIBILITY_TARGET_INVALID', '职责事项类型无效', 422);
  const row = type === 'case'
    ? await one(db, `SELECT c.id, c.process_ref, c.process_name, CAST(c.owning_department_id AS CHAR) AS owning_department_id,
        c.status, c.current_revision_no, c.current_content_hash FROM process_v7_preview_cases c WHERE c.id=CAST(? AS SIGNED) ${lock ? 'FOR UPDATE' : ''}`, [id])
    : await one(db, `SELECT p.id, d.process_ref, v.document_title AS process_name, CAST(p.owning_department_id AS CHAR) AS owning_department_id,
        p.status, p.revision_no AS current_revision_no, p.source_content_hash AS current_content_hash
        FROM process_data_governance_work_packages p JOIN process_design_versions v ON v.id=p.process_version_id
        JOIN process_design_documents d ON d.id=v.document_id WHERE p.id=CAST(? AS SIGNED) ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!row) throw fail('RESPONSIBILITY_TARGET_NOT_FOUND', '流程案例或治理工作包不存在', 404);
  retainedPackageReadable(type, row);
  return { ...row, id, target_type: type, target_id: id };
}
async function current(db, actor, lock = false) {
  if (sessionSubject(actor).kind === 'system_admin') {
    if (!(actor.permissions instanceof Set && actor.permissions.has('governance:read-global'))) throw fail('RESPONSIBILITY_READ_DENIED', '无权查看治理职责', 403);
    return { admin: true, effects: new Map([['governance:read-global', 'allow']]), grants: [] };
  }
  return activeActor(db, actor, lock);
}
async function validAssignment(db, row, targetRow, actor, qualification, kind) {
  if (!row || !row.person_id || !sameIdentityInteger(row.person_id, actor.personId) || qualification.admin) return false;
  if (kind === 'steward') return steward(qualification);
  return kind === 'owner' && targetRow.target_type === 'case' && sameIdentityInteger(row.department_id, targetRow.owning_department_id) &&
    sameIdentityInteger(qualification.current_department_id, targetRow.owning_department_id);
}
async function hasAssignedResponsibility(db, actor, type, id, kind = 'steward') {
  try {
    assertResponsibilityScope(type);
    const row = await assignment(db, type, id, kind);
    if (!row || !row.person_id || !sameIdentityInteger(row.person_id, actor.personId)) return false;
    const targetRow = await target(db, type, id);
    return validAssignment(db, row, targetRow, actor, await current(db, actor), kind);
  } catch (error) {
    if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'RESPONSIBILITY_MIGRATION_REQUIRED', 'V7_PREVIEW_DISABLED', 'PROCESS_DATA_GOVERNANCE_DISABLED', 'PROCESS_DATA_GOVERNANCE_COMPLETED_ONLY'].includes(error.code)) return false;
    throw error;
  }
}
// Caller holds the target business row lock. The assignment and qualifications
// remain locked on this connection until the caller commits its write.
async function assertAssignedSteward(db, actor, type, id) {
  try {
    assertResponsibilityScope(type, { write: true });
    const row = await assignment(db, type, id, 'steward', true);
    const qualification = await current(db, actor, true);
    if (!row || !row.person_id || !sameIdentityInteger(row.person_id, actor.personId) || !steward(qualification)) {
      throw fail('RESPONSIBILITY_ASSIGNMENT_REQUIRED', '仅当前有效的指定治理经办人可以办理该事项', 403);
    }
    return row;
  } catch (error) { throw migrationError(error); }
}
async function department(db, row, lock = false) {
  if (!row.owning_department_id) return null;
  return one(db, `SELECT CAST(id AS CHAR) AS id, CAST(final_responsible_person_id AS CHAR) AS final_responsible_person_id
    FROM departments WHERE id=CAST(? AS SIGNED) AND status='active' ${lock ? 'FOR SHARE' : ''}`, [row.owning_department_id]);
}
function canAppointOwner(qualification, dept) {
  return !qualification.admin && dept && sameIdentityInteger(dept.final_responsible_person_id, qualification.person_id) &&
    sameIdentityInteger(dept.id, qualification.current_department_id) && qualification.effects.get('governance:review-department') === 'allow' &&
    qualification.grants.some(grant => grant.role_code === 'department_mdm_reviewer' && grant.scope_type === 'department' && sameIdentityInteger(grant.scope_department_id, dept.id));
}
async function assertReadable(db, actor, row, qualification) {
  if (qualification.effects.get('governance:read-global') === 'allow') return;
  if (qualification.effects.get('governance:read-department') === 'allow' && sameIdentityInteger(qualification.current_department_id, row.owning_department_id)) return;
  const registeredDepartment = await department(db, row);
  if (!qualification.admin && registeredDepartment && sameIdentityInteger(registeredDepartment.final_responsible_person_id, qualification.person_id) &&
      sameIdentityInteger(registeredDepartment.id, qualification.current_department_id)) return;
  for (const kind of row.target_type === 'case' ? ['steward', 'owner'] : ['steward']) {
    if (await validAssignment(db, await assignment(db, row.target_type, row.id, kind), row, actor, qualification, kind)) return;
  }
  throw fail('RESPONSIBILITY_READ_DENIED', '无权查看该事项的治理职责', 403);
}
async function candidates(db, row, kind) {
  const items = await rows(db, `SELECT CAST(p.person_id AS CHAR) AS person_id, p.person_name, p.employee_no,
    CAST(p.current_department_id AS CHAR) AS department_id FROM person p
    JOIN departments d ON d.id=p.current_department_id
    JOIN user_accounts ua ON ua.person_id=p.person_id
    WHERE p.status='active' AND p.employment_status='active' AND d.status='active'
      AND ua.account_status='active' AND ua.must_change_password=0
      ${kind === 'owner' ? 'AND p.current_department_id=CAST(? AS SIGNED)' : ''}
      AND NOT EXISTS(SELECT 1 FROM person_roles ar JOIN roles rr ON rr.role_id=ar.role_id
        WHERE ar.person_id=p.person_id AND rr.role_code='admin' AND rr.status='active' AND rr.model_version=?
          AND ar.assignment_status='active' AND ar.effective_from<=CURRENT_DATE AND (ar.effective_to IS NULL OR ar.effective_to>=CURRENT_DATE))
      ${kind === 'steward' ? `AND EXISTS(SELECT 1 FROM person_roles sr JOIN roles rr ON rr.role_id=sr.role_id
        JOIN role_permissions rp ON rp.role_id=rr.role_id JOIN permissions pm ON pm.perm_id=rp.perm_id
        WHERE sr.person_id=p.person_id AND rr.role_code='mdm_steward' AND rr.status='active' AND rr.model_version=?
          AND sr.assignment_status='active' AND sr.effective_from<=CURRENT_DATE AND (sr.effective_to IS NULL OR sr.effective_to>=CURRENT_DATE)
          AND rp.effect='allow' AND pm.perm_code='governance:handle-assigned-work')` : ''}
    ORDER BY p.person_id LIMIT 201`, [...(kind === 'owner' ? [row.owning_department_id] : []), ACCESS_MODEL_VERSION, ...(kind === 'steward' ? [ACCESS_MODEL_VERSION] : [])]);
  return { items: items.slice(0, 200), truncated: items.length > 200 };
}
async function transaction(pool, action) {
  try { return await withMysqlTransactionDeadline(pool, action, 15000); }
  catch (error) {
    if (error.code === 'MYSQL_COMMIT_UNKNOWN') throw fail('RESPONSIBILITY_COMMIT_UNKNOWN', '操作结果尚未确认，请刷新核对任命或办理记录后再操作', 503);
    throw migrationError(error);
  }
}
function makeGovernanceResponsibilitiesRepository(pool) {
  async function describe(type, id, actor) {
    try {
      const row = await target(pool, type, id);
      const assignments = { steward: await assignment(pool, type, id, 'steward'), owner: type === 'case' ? await assignment(pool, type, id, 'owner') : null };
      const qualification = await current(pool, actor);
      await assertReadable(pool, actor, row, qualification);
      const department_accountability = type === 'case'
        ? await require('./departmentAccountability').inspectDepartmentAccountability(pool, actor, row.owning_department_id) : null;
      const allowed_actions = [];
      if (!['closed', 'completed', 'source_withdrawn'].includes(row.status)) {
        if (lead(qualification)) allowed_actions.push('assign_steward');
        if (type === 'case' && department_accountability.eligible) allowed_actions.push('assign_owner');
        if (type === 'case' && await validAssignment(pool, assignments.steward, row, actor, qualification, 'steward')) allowed_actions.push('record_work');
      }
      const history = await rows(pool, `SELECT e.*, CAST(e.id AS CHAR) AS id, CAST(e.target_id AS CHAR) AS target_id,
        CAST(e.person_id AS CHAR) AS person_id, CAST(e.previous_person_id AS CHAR) AS previous_person_id,
        CAST(e.actor_person_id AS CHAR) AS actor_person_id, p.person_name, a.person_name AS actor_name
        FROM process_governance_responsibility_events e LEFT JOIN person p ON p.person_id=e.person_id
        JOIN person a ON a.person_id=e.actor_person_id WHERE e.target_type=? AND e.target_id=CAST(? AS SIGNED) ORDER BY e.id DESC LIMIT 100`, [type, exactId(id)]);
      const work_records = type === 'case' ? await rows(pool, `SELECT w.*, CAST(w.id AS CHAR) AS id, CAST(w.case_id AS CHAR) AS case_id,
        CAST(w.actor_person_id AS CHAR) AS actor_person_id,p.person_name AS actor_name
        FROM process_governance_work_records w JOIN person p ON p.person_id=w.actor_person_id
        WHERE w.case_id=CAST(? AS SIGNED) ORDER BY w.id DESC LIMIT 100`, [exactId(id)]) : [];
      return { target_type: type, target_id: exactId(id), process_ref: row.process_ref, process_name: row.process_name,
        owning_department_id: row.owning_department_id, source_revision: Number(row.current_revision_no), source_hash: row.current_content_hash,
        assignments, history, history_limit: 100, work_records, work_record_limit: 100, allowed_actions, department_accountability,
        candidates: { stewards: allowed_actions.includes('assign_steward') ? await candidates(pool, row, 'steward') : { items: [], truncated: false },
          owners: allowed_actions.includes('assign_owner') ? await candidates(pool, row, 'owner') : { items: [], truncated: false } } };
    } catch (error) { throw migrationError(error); }
  }
  async function assign(type, id, kind, body, actor) {
    assertResponsibilityScope(type, { write: true });
    if (!['steward', 'owner'].includes(kind) || (type !== 'case' && kind === 'owner')) throw fail('RESPONSIBILITY_KIND_INVALID', '职责类型无效', 422);
    const basis = text(body.basis), expected = Number(body.expected_revision);
    if (!basis || basis.length > 8000 || !Number.isSafeInteger(expected) || expected < 0 || body.expected_revision == null) throw fail('RESPONSIBILITY_INPUT_INVALID', '须提供任命依据和当前职责版本', 422);
    if (!Object.prototype.hasOwnProperty.call(body, 'person_id')) throw fail('RESPONSIBILITY_PERSON_REQUIRED', '须明确指定人员或明确撤销', 422);
    const personId = body.person_id == null ? null : exactId(body.person_id);
    await transaction(pool, async db => {
      const row = await target(db, type, id, true);
      if (['closed', 'completed', 'source_withdrawn'].includes(row.status)) throw fail('RESPONSIBILITY_TARGET_CLOSED', '已结束事项不能更换治理职责');
      const previous = await assignment(db, type, id, kind, true);
      if (Number(previous && previous.revision_no || 0) !== expected) throw fail('RESPONSIBILITY_REVISION_CHANGED', '职责任命已变化，请刷新后核对');
      const qualification = await current(db, actor, true), dept = await department(db, row, true);
      if (qualification.admin || (kind === 'steward' ? !lead(qualification) : !canAppointOwner(qualification, dept))) throw fail('RESPONSIBILITY_ASSIGN_DENIED', kind === 'steward' ? '仅MDM组长可以分派治理经办人' : '仅归口部门最终负责人可以指定本部门流程负责人', 403);
      if (kind === 'owner') await require('./departmentAccountability').assertDepartmentAccountability(db, actor, row.owning_department_id, { lock: true });
      if (personId) {
        const account = await one(db, 'SELECT CAST(account_id AS CHAR) AS account_id, CAST(auth_version AS CHAR) AS auth_version FROM user_accounts WHERE person_id=CAST(? AS SIGNED) FOR SHARE', [personId]);
        if (!account) throw fail('RESPONSIBILITY_PERSON_INELIGIBLE', '所选人员不具备有效办理资格', 422);
        const candidate = await activeActor(db, { personId, accountId: account.account_id, authVersion: account.auth_version }, true);
        if (candidate.admin || (kind === 'steward' ? !steward(candidate) : !sameIdentityInteger(candidate.current_department_id, row.owning_department_id))) throw fail('RESPONSIBILITY_PERSON_INELIGIBLE', '所选人员不具备该职责的有效资格或部门范围', 422);
      }
      await db.execute(`INSERT INTO process_governance_responsibilities
        (target_type,target_id,assignment_kind,process_ref,person_id,department_id,revision_no,basis_text,actor_person_id)
        VALUES (?,CAST(? AS SIGNED),?,?,CAST(? AS SIGNED),CAST(? AS SIGNED),?,?,CAST(? AS SIGNED))
        ON DUPLICATE KEY UPDATE process_ref=VALUES(process_ref),person_id=VALUES(person_id),department_id=VALUES(department_id),
        revision_no=VALUES(revision_no),basis_text=VALUES(basis_text),actor_person_id=VALUES(actor_person_id)`,
      [type, exactId(id), kind, row.process_ref, personId, row.owning_department_id, expected + 1, basis, exactId(actor.personId)]);
      await db.execute(`INSERT INTO process_governance_responsibility_events
        (target_type,target_id,assignment_kind,process_ref,person_id,previous_person_id,department_id,revision_no,basis_text,actor_person_id)
        VALUES (?,CAST(? AS SIGNED),?,?,CAST(? AS SIGNED),CAST(? AS SIGNED),CAST(? AS SIGNED),?,?,CAST(? AS SIGNED))`,
      [type, exactId(id), kind, row.process_ref, personId, previous && previous.person_id, row.owning_department_id, expected + 1, basis, exactId(actor.personId)]);
    });
    return describe(type, id, actor);
  }
  async function recordWork(id, body, actor) {
    assertResponsibilityScope('case', { write: true });
    const content = text(body.content), basis = text(body.basis), key = text(body.request_key);
    if (!content || content.length > 12000 || !basis || basis.length > 8000 || !/^[A-Za-z0-9:_-]{8,80}$/.test(key)) throw fail('RESPONSIBILITY_WORK_INPUT_INVALID', '须填写办理说明、依据和有效请求标识', 422);
    const expected = Number(body.expected_revision), sourceRevision = Number(body.expected_source_revision), sourceHash = text(body.expected_source_hash);
    if (!Number.isSafeInteger(expected) || expected < 1 || !Number.isSafeInteger(sourceRevision) || sourceRevision < 1 || !/^[a-f0-9]{64}$/i.test(sourceHash)) throw fail('RESPONSIBILITY_WORK_SOURCE_REQUIRED', '须提供当前任命版本和流程修订摘要', 422);
    return transaction(pool, async db => {
      const row = await target(db, 'case', id, true);
      if (row.status === 'closed') throw fail('RESPONSIBILITY_TARGET_CLOSED', '已结束案例不能记录新办理说明');
      const assigned = await assertAssignedSteward(db, actor, 'case', id);
      const hash = crypto.createHash('sha256').update(JSON.stringify({ content, basis, expected, sourceRevision, sourceHash, personId: exactId(actor.personId) })).digest('hex');
      const previous = await one(db, 'SELECT CAST(id AS CHAR) AS id, request_hash FROM process_governance_work_records WHERE case_id=CAST(? AS SIGNED) AND request_key=? FOR UPDATE', [exactId(id), key]);
      if (previous) { if (previous.request_hash !== hash) throw fail('RESPONSIBILITY_REQUEST_CONFLICT', '同一请求标识已经用于不同办理内容'); return { idempotent: true, record_id: previous.id }; }
      if (assigned.revision_no !== expected || Number(row.current_revision_no) !== sourceRevision || row.current_content_hash !== sourceHash) throw fail('RESPONSIBILITY_WORK_SOURCE_CHANGED', '任命或流程来源已变化，请刷新核对后记录');
      const [result] = await db.execute(`INSERT INTO process_governance_work_records
        (case_id,process_ref,request_key,request_hash,content_text,basis_text,actor_person_id,assignment_revision_no,source_revision_no,source_content_hash)
        VALUES (CAST(? AS SIGNED),?,?,?,?,?,CAST(? AS SIGNED),?,?,?)`, [exactId(id), row.process_ref, key, hash, content, basis, exactId(actor.personId), expected, sourceRevision, sourceHash]);
      return { idempotent: false, record_id: String(result.insertId) };
    });
  }
  async function workbench(actor) {
    try {
      const enabledTypes = [process.env.PROCESS_V7_PREVIEW_ENABLED === '1' ? 'case' : null, isProcessDataGovernanceEnabled() ? 'work_package' : null].filter(Boolean);
      if (!enabledTypes.length) return { items: [] };
      await requirePrepared(pool);
      const qualification = await current(pool, actor);
      if (qualification.admin) return { items: [] };
      const assigned = await rows(pool, `SELECT a.*, CAST(a.target_id AS CHAR) AS target_id, CAST(a.person_id AS CHAR) AS person_id,
        CAST(a.department_id AS CHAR) AS department_id FROM process_governance_responsibilities a WHERE a.person_id=CAST(? AS SIGNED)
        AND a.target_type IN (${enabledTypes.map(() => '?').join(',')}) ORDER BY a.updated_at DESC`, [exactId(actor.personId), ...enabledTypes]);
      const items = [];
      for (const binding of assigned) {
        let row;
        try { row = await target(pool, binding.target_type, binding.target_id); }
        catch (error) { if (error.code === 'PROCESS_DATA_GOVERNANCE_COMPLETED_ONLY') continue; throw error; }
        if (await validAssignment(pool, binding, row, actor, qualification, binding.assignment_kind)) items.push({ ...normalized(binding), process_name: row.process_name, status: row.status });
      }
      if (!enabledTypes.includes('case')) return { items };
      const finalDepartments = await rows(pool, `SELECT CAST(id AS CHAR) AS id FROM departments
        WHERE final_responsible_person_id=CAST(? AS SIGNED) AND id=CAST(? AS SIGNED) AND status='active'`, [exactId(actor.personId), qualification.current_department_id]);
      for (const dept of finalDepartments) {
        const accountability = await require('./departmentAccountability').inspectDepartmentAccountability(pool, actor, dept.id);
        const cases = await rows(pool, `SELECT CAST(c.id AS CHAR) AS target_id,c.process_ref,c.process_name,c.status
          FROM process_v7_preview_cases c WHERE c.owning_department_id=CAST(? AS SIGNED) AND c.status<>'closed'
          ORDER BY c.updated_at DESC`, [dept.id]);
        for (const item of cases) if (!items.some(existing => existing.target_type === 'case' && existing.target_id === item.target_id && existing.assignment_kind === 'owner')) {
          items.push({ ...item, target_type: 'case', assignment_kind: 'owner', department_id: dept.id,
            appointment_action: accountability.eligible ? 'assign_owner' : null, department_accountability: accountability });
        }
      }
      return { items };
    } catch (error) { throw migrationError(error); }
  }
  return { describe, assign, recordWork, workbench };
}
module.exports = { RESPONSIBILITIES_MIGRATION_KEY, makeGovernanceResponsibilitiesRepository, hasAssignedResponsibility, assertAssignedSteward, assertResponsibilityScope, fail, migrationError, steward, lead };
