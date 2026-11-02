// This narrow account-maintenance operation binds one department responsibility;
// it grants no general directory-editing authority and never revokes the old grant.
const { identityInteger, sameIdentityInteger } = require('./sessionSubject');
const { policyState, ROLE_CODE } = require('./departmentAccountability');
const fail = (statusCode, code, message, details) => Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
const exact = value => { const id = identityInteger(value); return id === null ? null : String(id); };
const one = async (db, sql, params = []) => (await db.execute(sql, params))[0][0] || null;

async function prepareDepartmentHeadAppointment(db, personId, assignment, payload) {
  if (assignment.roleCode !== ROLE_CODE) return null;
  if (!Object.prototype.hasOwnProperty.call(payload, 'expectedFinalResponsiblePersonId') || payload.expectedFinalResponsiblePersonId === undefined) {
    throw fail(422, 'DEPARTMENT_HEAD_SNAPSHOT_REQUIRED', '请刷新所属部门的现负责人信息后重新办理');
  }
  const expected = payload.expectedFinalResponsiblePersonId === null ? null : exact(payload.expectedFinalResponsiblePersonId);
  if (payload.expectedFinalResponsiblePersonId !== null && expected === null) throw fail(422, 'DEPARTMENT_HEAD_SNAPSHOT_INVALID', '现负责人标识无效，请刷新后重新办理');
  if (!(await policyState(db, { lock: true })).ready) throw fail(503, 'DEPARTMENT_ACCOUNTABILITY_POLICY_REQUIRED', '部门负责人确认规则尚未准备，不能办理任命');
  // Registration may precede account creation. Lock an existing account without
  // creating one; confirmation still requires the normal active-account gate.
  await one(db, 'SELECT CAST(account_id AS CHAR) account_id FROM user_accounts WHERE person_id=CAST(? AS SIGNED) FOR UPDATE', [exact(personId)]);
  const person = await one(db, `SELECT CAST(person_id AS CHAR) person_id,CAST(current_department_id AS CHAR) current_department_id,status,employment_status
    FROM person WHERE person_id=CAST(? AS SIGNED) FOR UPDATE`, [exact(personId)]);
  if (!person || person.status !== 'active' || person.employment_status !== 'active') throw fail(422, 'PERSON_INACTIVE', '部门负责人必须是有效在职人员');
  if (!sameIdentityInteger(person.current_department_id, assignment.scopeDepartmentId)) throw fail(422, 'ROLE_SCOPE_DEPARTMENT_MISMATCH', '部门负责人只能登记为人员所属部门的负责人');
  const department = await one(db, `SELECT CAST(id AS CHAR) id,status,CAST(final_responsible_person_id AS CHAR) final_responsible_person_id,
    DATE_FORMAT(CURRENT_DATE,'%Y-%m-%d') current_date_value FROM departments WHERE id=CAST(? AS SIGNED) FOR UPDATE`, [exact(assignment.scopeDepartmentId)]);
  if (!department || department.status !== 'active') throw fail(422, 'ACTIVE_DEPARTMENT_REQUIRED', '人员所属部门不存在或未启用');
  if (assignment.effectiveFrom > department.current_date_value || (assignment.effectiveTo && assignment.effectiveTo < department.current_date_value)) {
    throw fail(422, 'DEPARTMENT_HEAD_CURRENT_APPOINTMENT_REQUIRED', '这里只办理当前生效的部门负责人任命，不能设置未来或已失效的任命');
  }
  const current = exact(department.final_responsible_person_id);
  if (current !== expected) throw fail(409, 'DEPARTMENT_FINAL_RESPONSIBLE_CHANGED', '部门现负责人已变化，请刷新后重新确认', { currentFinalResponsiblePersonId: current });
  const replacing = current !== null && current !== exact(personId);
  if (replacing && payload.confirmReplaceFinalResponsiblePerson !== true) {
    throw fail(409, 'DEPARTMENT_HEAD_REPLACEMENT_CONFIRMATION_REQUIRED', '该部门已有其他负责人，请明确确认更换后再办理', { currentFinalResponsiblePersonId: current });
  }
  const appointment = { departmentId: exact(department.id), previousFinalResponsiblePersonId: current, finalResponsiblePersonId: exact(personId), changed: current !== exact(personId) };
  if (appointment.changed) {
    // Department X serializes with the confirmation's department S. A locking
    // current read includes decisions committed after any earlier RR snapshot.
    const latest = await one(db, `SELECT CAST(decision_record_id AS CHAR) decision_record_id FROM governance_decision_records
      WHERE department_id=CAST(? AS SIGNED) ORDER BY decision_record_id DESC LIMIT 1 FOR SHARE`, [appointment.departmentId]);
    appointment.decisionRecordCutoff = latest ? exact(latest.decision_record_id) : '0';
  }
  return appointment;
}

async function registerDepartmentHead(db, appointment) {
  if (!appointment || !appointment.changed) return;
  const [result] = await db.execute(`UPDATE departments SET final_responsible_person_id=CAST(? AS SIGNED)
    WHERE id=CAST(? AS SIGNED) AND final_responsible_person_id <=> CAST(? AS SIGNED)`,
  [appointment.finalResponsiblePersonId, appointment.departmentId, appointment.previousFinalResponsiblePersonId]);
  if (Number(result.affectedRows) !== 1) throw fail(409, 'DEPARTMENT_FINAL_RESPONSIBLE_CHANGED', '部门现负责人已变化，请刷新后重新确认');
  if (appointment.previousFinalResponsiblePersonId !== null) {
    await db.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=CAST(? AS SIGNED)', [appointment.previousFinalResponsiblePersonId]);
  }
}

module.exports = { prepareDepartmentHeadAppointment, registerDepartmentHead };
