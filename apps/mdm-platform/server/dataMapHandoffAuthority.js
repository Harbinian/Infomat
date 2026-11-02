// The caller owns the connection, business locks and transaction. No pool lookup,
// transaction boundary, model migration or role grant is performed here.
const crypto = require('node:crypto');
const { readPersonAuthority } = require('./identityMysqlRepository');
const { sessionSubject, identityInteger, sameIdentityInteger } = require('./sessionSubject');
const v4 = require('./accessModelV4Baseline');
const v5 = require('./roleDefinitions');

const SUPPORTED_ACCESS_MODELS = Object.freeze([v4.ACCESS_MODEL_VERSION, v5.ACCESS_MODEL_VERSION]);
const CORE_ROLES = v4.ROLE_GUIDES.map(role => role.code).sort();
const ACTIONS = new Set(['read', 'prepare', 'review', 'approve', 'publish', 'withdraw', 'restore',
  'fact_read', 'fact_answer', 'fact_close', 'fact_confirm', 'conflict_read', 'conflict_viewpoint', 'coordinate', 'conflict', 'escalate', 'decide']);
const PUBLISH_ACTIONS = new Set(['approve', 'publish', 'withdraw', 'restore']);
const id = value => { const result = identityInteger(value); return result == null ? null : String(result); };
const one = async (db, sql, params = []) => (await db.execute(sql, params))[0][0] || null;
function fail(code, message, statusCode = 403, extra = {}) {
  return Object.assign(new Error(message), { code, statusCode, payload: { code, error: message, ...extra } });
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');

async function inspectHandoffAccessModel(db, { lock = true } = {}) {
  const placeholders = CORE_ROLES.map(() => '?').join(',');
  const [roles] = await db.execute(`SELECT role_code,status,model_version FROM roles
    WHERE role_code IN (${placeholders}) ORDER BY role_code ${lock ? 'FOR SHARE' : ''}`, CORE_ROLES);
  const models = [...new Set(roles.map(role => role.model_version))];
  if (roles.length !== CORE_ROLES.length || roles.some(role => role.status !== 'active') || models.length !== 1 || !SUPPORTED_ACCESS_MODELS.includes(models[0])) {
    throw fail('HANDOFF_ACCESS_MODEL_UNSUPPORTED', '目标权限模型缺失、混合或未经验证，不能办理数据地图承接', 503,
      { supported_models: SUPPORTED_ACCESS_MODELS, actual_models: models });
  }
  return models[0];
}

function scopedPermission(grants, permission, departmentId = null) {
  const matching = grants.filter(grant => grant.perm_code === permission);
  // A direct effective deny cannot be hidden by an allow from another role.
  if (matching.some(grant => grant.effect === 'deny')) return false;
  return matching.some(grant => grant.effect === 'allow' &&
    (grant.scope_type === 'global' || (departmentId && grant.scope_type === 'department' && sameIdentityInteger(grant.scope_department_id, departmentId))));
}
function roleInScope(grants, code, departmentId = null) {
  return grants.some(grant => grant.role_code === code &&
    (grant.scope_type === 'global' || (departmentId && grant.scope_type === 'department' && sameIdentityInteger(grant.scope_department_id, departmentId))));
}
function allPermissions(authority, grants, codes, departmentId = null) {
  return codes.every(code => authority.permissions.has(code) && scopedPermission(grants, code, departmentId));
}

async function workAssignment(db, packageId, lock) {
  if (!packageId) return null;
  // Assignment maintenance already owns package -> assignment -> actor locks.
  // Taking this before identity anchors avoids reversing that existing order.
  return one(db, `SELECT CAST(id AS CHAR) id,CAST(person_id AS CHAR) person_id,
    CAST(department_id AS CHAR) department_id,revision_no,basis_text
    FROM process_governance_responsibilities WHERE target_type='work_package'
      AND target_id=CAST(? AS SIGNED) AND assignment_kind='steward' ${lock ? 'FOR UPDATE' : ''}`, [id(packageId)]);
}

async function factScope(db, { packageId, departmentId, factRequestId, factKind = 'work_package' }, lock) {
  if (!factRequestId || !['work_package', 'handoff_correction', 'handoff_conflict'].includes(factKind)) throw fail('HANDOFF_FACT_SCOPE_REQUIRED', '须明确指定当前业务事实问题及其来源范围');
  if (factKind !== 'work_package') {
    const version = await one(db, `SELECT fact_version_id,CAST(package_id AS CHAR) package_id,revision_no,snapshot_json
      FROM process_data_governance_fact_versions WHERE fact_id=? ORDER BY revision_no DESC LIMIT 1 ${lock ? 'FOR SHARE' : ''}`, [factRequestId]);
    let snapshot;
    try { snapshot = version && (typeof version.snapshot_json === 'string' ? JSON.parse(version.snapshot_json) : version.snapshot_json); } catch { snapshot = null; }
    if (!version || !snapshot || snapshot.fact_id !== factRequestId || !sameIdentityInteger(version.package_id, packageId) ||
        !id(snapshot.target_department_id) || (factKind === 'handoff_conflict') !== (snapshot.parent_kind === 'handoff_conflict') ||
        (departmentId && !sameIdentityInteger(snapshot.target_department_id, departmentId))) throw fail('HANDOFF_FACT_SCOPE_DENIED', '无权办理其他工作包或部门的业务事实问题');
    return { id: factRequestId, fact_version_id: version.fact_version_id, package_id: id(version.package_id),
      department_id: id(snapshot.target_department_id), status: snapshot.status, revision_no: Number(version.revision_no) };
  }
  const fact = await one(db, `SELECT CAST(id AS CHAR) id,CAST(work_package_id AS CHAR) package_id,
    CAST(target_department_id AS CHAR) department_id,status FROM process_data_governance_fact_requests
    WHERE id=CAST(? AS SIGNED) ${lock ? 'FOR UPDATE' : ''}`, [id(factRequestId)]);
  if (!fact || !packageId || !sameIdentityInteger(fact.package_id, packageId) ||
      (departmentId && !sameIdentityInteger(fact.department_id, departmentId))) throw fail('HANDOFF_FACT_SCOPE_DENIED', '无权办理其他工作包或部门的业务事实问题');
  return fact;
}

async function readGrants(db, personId, modelVersion, lock) {
  const [grants] = await db.execute(`SELECT CAST(pr.person_role_id AS CHAR) assignment_id,
    r.role_code,pr.scope_type,CAST(pr.scope_department_id AS CHAR) scope_department_id,
    pr.authorization_basis,DATE_FORMAT(pr.effective_from,'%Y-%m-%d') effective_from,
    DATE_FORMAT(pr.effective_to,'%Y-%m-%d') effective_to,p.perm_code,rp.effect
    FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id
    LEFT JOIN role_permissions rp ON rp.role_id=r.role_id LEFT JOIN permissions p ON p.perm_id=rp.perm_id
    WHERE pr.person_id=CAST(? AS SIGNED) AND r.status='active' AND r.model_version=?
      AND pr.assignment_status='active' AND pr.effective_from IS NOT NULL AND pr.effective_from<=CURRENT_DATE
      AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
    ORDER BY pr.person_role_id,p.perm_code ${lock ? 'FOR SHARE' : ''}`, [id(personId), modelVersion]);
  return grants;
}

async function resolveHandoffActor(db, session, action, options = {}, qualificationOnly = false) {
  const { packageId = null, departmentId = null, lock = true, readOnly = false, conflictId = null,
    factRequestId = null, factKind = 'work_package', writeFields = null } = options;
  if (!ACTIONS.has(action)) throw fail('HANDOFF_ACTION_INVALID', '承接动作无效', 422);
  const writing = !['read', 'fact_read', 'conflict_read'].includes(action);
  if (writing && !qualificationOnly && (!lock || readOnly)) throw fail('HANDOFF_READ_ONLY', '只读检查不能用于承接写入');
  if(qualificationOnly&&lock)throw fail('HANDOFF_READ_ONLY', '资格发现必须使用只读快照');
  const subject = sessionSubject(session);
  if (subject.kind === 'system_admin') {
    if (writing) throw fail('HANDOFF_ADMIN_READ_ONLY', '管理员对治理材料只读');
    if (session.personId || process.env.MDM_SYSTEM_ADMIN_ENABLED !== '1' || !id(subject.accountId) || !id(subject.authVersion)) throw fail('HANDOFF_ACCESS_CHANGED', '独立管理员登录信息已失效', 401);
    const modelVersion = await inspectHandoffAccessModel(db, { lock });
    const marker = await one(db, `SELECT migration_key FROM schema_migrations WHERE migration_key=? ${lock ? 'FOR SHARE' : ''}`,
      [require('./systemAdminMigration').MIGRATION_KEY]);
    if (!marker) throw fail('HANDOFF_AUTHORITY_SCHEMA_REQUIRED', '独立管理员身份结构尚未准备', 503);
    const account = await one(db, `SELECT CAST(account_id AS CHAR) account_id,CAST(auth_version AS CHAR) auth_version,
      account_status,must_change_password FROM system_admin_accounts WHERE account_id=CAST(? AS SIGNED) ${lock ? 'FOR SHARE' : ''}`, [id(subject.accountId)]);
    if (!account || account.account_status !== 'active' || account.must_change_password || !sameIdentityInteger(account.auth_version, subject.authVersion)) throw fail('HANDOFF_ACCESS_CHANGED', '独立管理员账号或授权已变化', 401);
    const [permissions] = await db.execute(`SELECT p.perm_code,rp.effect FROM roles r
      JOIN role_permissions rp ON rp.role_id=r.role_id JOIN permissions p ON p.perm_id=rp.perm_id
      WHERE r.role_code='admin' AND r.status='active' AND r.model_version=? ${lock ? 'FOR SHARE' : ''}`, [modelVersion]);
    if (!permissions.some(row => row.perm_code === 'governance:read-global' && row.effect === 'allow') ||
        permissions.some(row => row.perm_code === 'governance:read-global' && row.effect === 'deny')) throw fail('HANDOFF_ACTION_DENIED', '当前独立管理员无治理读取权限');
    return { ...session, personId: null, userId: subject.principal, accountId: id(subject.accountId), authVersion: id(subject.authVersion),
      departmentId: null, modelVersion, roleCodes: new Set(['admin']), permissions: new Set(['governance:read-global']),
      fieldConstraints: {}, qualificationSnapshot: null, factScope: null, conflictScope: null, roleCode: 'admin' };
  }
  if (!id(subject.personId) || !id(subject.accountId) || !id(subject.authVersion)) throw fail('HANDOFF_ACCESS_CHANGED', '账号或授权已变化，请重新登录核对', 401);
  let assignment = null, fact = null, conflict = null;
  try {
    assignment = await workAssignment(db, packageId, lock);
    if (['fact_read', 'fact_answer', 'fact_confirm', 'fact_close'].includes(action)) fact = await factScope(db, { packageId, departmentId, factRequestId, factKind }, lock);
    if (['conflict', 'escalate', 'decide', 'conflict_read', 'conflict_viewpoint', 'coordinate'].includes(action)) {
      if (!conflictId || !packageId) throw fail('HANDOFF_CONFLICT_SCOPE_REQUIRED', '须明确指定当前冲突及工作包');
      conflict = await one(db, `SELECT conflict_id,CAST(package_id AS CHAR) package_id,state,
        CAST(assignee_person_id AS CHAR) assignee_person_id,CAST(decision_person_id AS CHAR) decision_person_id,revision_no
        FROM data_map_handoff_conflicts WHERE conflict_id=? ${lock ? 'FOR UPDATE' : ''}`, [conflictId]);
      if (!conflict || !sameIdentityInteger(conflict.package_id, packageId)) throw fail('HANDOFF_CONFLICT_SCOPE_DENIED', '无权处理其他工作包的冲突');
    }
    if (lock) {
      await db.execute('SELECT CAST(account_id AS CHAR) account_id FROM user_accounts WHERE account_id=CAST(? AS SIGNED) FOR UPDATE', [id(subject.accountId)]);
      await db.execute('SELECT CAST(person_id AS CHAR) person_id FROM person WHERE person_id=CAST(? AS SIGNED) FOR UPDATE', [id(subject.personId)]);
      // A shared next-key range lock protects existing grants and the insertion
      // gap through commit; authority readers never update these assignments.
      await db.execute('SELECT CAST(person_role_id AS CHAR) person_role_id FROM person_roles WHERE person_id=CAST(? AS SIGNED) FOR SHARE', [id(subject.personId)]);
    }
    const modelVersion = await inspectHandoffAccessModel(db, { lock });
    const authority = await readPersonAuthority(db, session, subject.personId,
      { currentRead: lock, includeFieldConstraints: true, accessModelVersion: modelVersion });
    if (!authority.valid || !authority.user || authority.user.employment_status !== 'active' || !authority.department || authority.department.status !== 'active') {
      throw fail('HANDOFF_ACCESS_CHANGED', '账号、人员或部门状态及授权已变化，请重新登录核对', 401);
    }
    const currentDepartmentId = id(authority.user.current_department_id);
    const grants = await readGrants(db, subject.personId, modelVersion, lock);
    if (writing && (authority.readOnly || grants.some(grant => grant.role_code === 'admin'))) throw fail('HANDOFF_ADMIN_READ_ONLY', '管理员对治理材料只读，叠加业务角色也不能写入');
    const allowed = codes => allPermissions(authority, grants, codes);
    const lead = roleInScope(grants, 'mdm_lead') && allowed(['governance:assign-work', 'governance:structure-gate']);
    const assigned = packageId && assignment && sameIdentityInteger(assignment.person_id, subject.personId);
    const steward = assigned && roleInScope(grants, 'mdm_steward') && allowed(['governance:handle-assigned-work', 'governance:read-assigned-context']);
    const conflictHandler = conflict && sameIdentityInteger(conflict.assignee_person_id, subject.personId) && roleInScope(grants, 'data_conflict_handler') && allowed(['governance:handle-assigned-conflict']);
    const conflictDecisionReader = conflict && sameIdentityInteger(conflict.decision_person_id, subject.personId) && roleInScope(grants, 'decision_group') && allowed(['governance:decide-escalation', 'governance:read-escalated-context']);
    let eligible = false;
    if (action === 'read') eligible = allowed(['governance:read-global']) || steward;
    else if (action === 'conflict_read') eligible = allowed(['governance:read-global']) || steward || conflictHandler || conflictDecisionReader;
    else if (action === 'conflict_viewpoint') eligible = lead || steward || conflictHandler;
    else if (action === 'coordinate') eligible = lead || conflictHandler;
    else if (PUBLISH_ACTIONS.has(action)) eligible = lead && allowed(['governance:publish']);
    else if (action === 'review') eligible = lead;
    else if (action === 'prepare' || action === 'fact_close') eligible = lead || steward;
    else if (action === 'fact_read' || action === 'fact_answer' || action === 'fact_confirm') {
      const target = fact.department_id;
      const departmentMatch = sameIdentityInteger(target, currentDepartmentId);
      const contact = roleInScope(grants, 'department_contact', target) && allPermissions(authority, grants, ['governance:draft-department'], target);
      const reviewer = roleInScope(grants, 'department_mdm_reviewer', target) && allPermissions(authority, grants, ['governance:review-department', 'governance:record-department-decision'], target) && sameIdentityInteger(authority.department.final_responsible_person_id, subject.personId);
      eligible = departmentMatch && (action === 'fact_confirm' ? reviewer : contact || reviewer);
    } else if (action === 'decide') eligible = conflict.state === 'escalated' && sameIdentityInteger(conflict.decision_person_id, subject.personId) && roleInScope(grants, 'decision_group') && allowed(['governance:decide-escalation', 'governance:read-escalated-context']);
    else eligible = ['open', 'escalated'].includes(conflict.state) && conflictHandler && allowed(['governance:handle-assigned-conflict', ...(action === 'escalate' ? ['governance:escalate-conflict'] : [])]);
    if (fact && action === 'fact_answer' && fact.status !== 'open') throw fail('HANDOFF_FACT_NOT_OPEN', '该业务事实问题当前不能答复', 409);
    if (fact && action === 'fact_close' && fact.status !== (factKind === 'handoff_conflict' ? 'confirmed' : 'answered')) throw fail(factKind === 'handoff_conflict' ? 'HANDOFF_FACT_NOT_CONFIRMED' : 'HANDOFF_FACT_NOT_ANSWERED', '业务部门尚未完成所需确认，不能关闭事实问题', 409);
    if (!eligible) throw fail('HANDOFF_ACTION_DENIED', '当前资格、权限或分派范围不允许执行该承接动作');
    if (writing) {
      const required = PUBLISH_ACTIONS.has(action) ? ['governance:assign-work', 'governance:structure-gate', 'governance:publish']
        : action === 'review' || (['prepare', 'fact_close', 'conflict_viewpoint', 'coordinate'].includes(action) && lead) ? ['governance:assign-work', 'governance:structure-gate']
          : ['prepare', 'fact_close'].includes(action) || action === 'conflict_viewpoint' && steward ? ['governance:handle-assigned-work', 'governance:read-assigned-context']
            : action === 'decide' ? ['governance:decide-escalation', 'governance:read-escalated-context']
              : ['conflict', 'escalate', 'conflict_viewpoint', 'coordinate'].includes(action) ? ['governance:handle-assigned-conflict', ...(action === 'escalate' ? ['governance:escalate-conflict'] : [])]
                : action === 'fact_answer' && roleInScope(grants, 'department_contact', fact.department_id) && allPermissions(authority, grants, ['governance:draft-department'], fact.department_id)
                  ? ['governance:draft-department'] : ['governance:review-department', 'governance:record-department-decision'];
      const readonlyFields = [...new Set(required.flatMap(code => {
        const fields = authority.fieldConstraints[code] && authority.fieldConstraints[code].readonly;
        return Array.isArray(fields) ? fields : [];
      }))];
      if (readonlyFields.length && !Array.isArray(writeFields)) throw fail('HANDOFF_FIELD_SCOPE_REQUIRED', '当前权限含字段只读约束，须先核对本次实际写入字段', 503);
      const blocked = readonlyFields.filter(field => writeFields && writeFields.includes(field));
      if (blocked.length) throw fail('HANDOFF_FIELDS_READ_ONLY', '本次包含权限限定的只读字段，不能写入', 403, { readonly_fields: blocked });
    }
    // A department's final fact confirmation does not depend on which MDM
    // worker handles the package. Its assignment anchor is still locked above.
    const qualification = { person_id: id(subject.personId), account_id: id(subject.accountId), auth_version: id(subject.authVersion),
      department_id: currentDepartmentId, model_version: modelVersion, grants, field_constraints: authority.fieldConstraints,
      assignment: action==='fact_confirm'&&factKind==='handoff_conflict'?null:assignment ? { id: id(assignment.id), person_id: id(assignment.person_id), revision_no: Number(assignment.revision_no) } : null };
    if (action === 'fact_confirm' && factKind === 'handoff_conflict') {
      const appointment = await require('./departmentAccountability').readDepartmentAppointment(db, fact.department_id, { lock });
      qualification.department_confirmation = { final_responsible_person_id: id(authority.department.final_responsible_person_id), appointment_event_id: appointment.appointment_event_id };
    }
    const qualificationSnapshot = qualificationOnly ? null : { ...qualification, qualification_digest: digest(qualification) };
    return { ...session, personId: id(subject.personId), userId: id(subject.personId), accountId: id(subject.accountId), authVersion: id(subject.authVersion),
      departmentId: currentDepartmentId, modelVersion, roleCodes: authority.roleCodes, permissions: authority.permissions,
      fieldConstraints: authority.fieldConstraints, qualificationSnapshot, factScope: fact, conflictScope: conflict,
      personName: authority.user.person_name || authority.user.personName || authority.user.name || null,
      ...(qualificationOnly?{qualification_only:true,readOnly:true}:{}),
      roleCode: lead ? 'mdm_lead' : steward ? 'mdm_steward'
        : action === 'decide' || action === 'conflict_read' && conflictDecisionReader ? 'decision_group' : ['conflict', 'escalate', 'coordinate', 'conflict_viewpoint', 'conflict_read'].includes(action) && conflictHandler ? 'data_conflict_handler'
          : roleInScope(grants, 'department_mdm_reviewer', currentDepartmentId) ? 'department_mdm_reviewer'
            : roleInScope(grants, 'department_contact', currentDepartmentId) ? 'department_contact' : authority.readOnly ? 'admin' : null };
  } catch (error) {
    if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error.code)) throw fail('HANDOFF_AUTHORITY_SCHEMA_REQUIRED', '承接权限或职责结构尚未准备', 503);
    throw error;
  }
}
async function handoffActor(db,session,action,options={}){
  return resolveHandoffActor(db,session,action,options,false);
}
// Discovery checks the same current model, scope, deny, assignment and field
// rules in one MVCC snapshot. Its result is not a mutation/approval actor.
async function probeHandoffActor(db,session,action,options={}){
  return resolveHandoffActor(db,session,action,{...options,lock:false,readOnly:true},true);
}

async function assertApprover(db, snapshot, { packageId = null, lock = true } = {}) {
  if (!snapshot || !snapshot.qualification_digest || digest(Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'qualification_digest'))) !== snapshot.qualification_digest) {
    throw fail('HANDOFF_APPROVER_CHANGED', '批准人资格记录缺失或不完整，须重新批准');
  }
  try {
    // This assertion writes no business fields; the executing actor separately
    // validates the actual publication payload. Constraint changes still alter
    // the qualification digest and invalidate the previous approval.
    const actor = await handoffActor(db, { personId: snapshot.person_id, accountId: snapshot.account_id, authVersion: snapshot.auth_version }, 'approve', { packageId, lock, writeFields: [] });
    if (actor.qualificationSnapshot.qualification_digest !== snapshot.qualification_digest) throw fail('HANDOFF_APPROVER_CHANGED', '批准人的当前资格或本包分派已变化，须重新批准');
    return actor;
  } catch (error) {
    if (error.code === 'HANDOFF_AUTHORITY_SCHEMA_REQUIRED' || error.code === 'HANDOFF_ACCESS_MODEL_UNSUPPORTED') throw error;
    throw fail('HANDOFF_APPROVER_CHANGED', '批准人的当前资格或本包分派已变化，须重新批准');
  }
}

module.exports = { SUPPORTED_ACCESS_MODELS, inspectHandoffAccessModel, scopedPermission, handoffActor, probeHandoffActor, assertApprover };
