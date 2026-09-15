// Manual directory publications alone establish office ownership and membership.
const key = value => String(value || '').trim().toLowerCase();

async function officeSnapshot(db, lock) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [offices] = await db.query('SELECT org_unit_id,org_unit_code,org_unit_name,org_type,department_id,manager_person_id,status FROM org_unit ORDER BY org_unit_id' + suffix);
  const [memberships] = await db.query('SELECT office_id,person_id,status FROM office_membership ORDER BY office_id,person_id' + suffix);
  const [pending] = await db.query("SELECT a.todo_id,a.office_id,a.assignee_person_id FROM mdm_todo_office_assignments a JOIN mdm_todos t ON t.id=a.todo_id WHERE t.status='pending' ORDER BY a.todo_id" + suffix);
  return { offices, memberships, pending };
}

function planOffice(record, fields, snapshot, departments, persons, incoming, row) {
  const errors = [], existing = snapshot.offices.find(o => key(o.org_unit_code) === key(record.code));
  const department = departments.find(d => key(d.code) === key(record.owning_department_code));
  const proposedDepartment = incoming.find(d => d.unit_type === 'department' && key(d.code) === key(record.owning_department_code));
  const manager = fields.manager_employee_no ? persons.find(p => key(p.employee_no) === key(record.manager_employee_no)) : persons.find(p => Number(p.person_id) === Number(existing?.manager_person_id));
  const desired = { code:record.code, name:record.name, department_code:record.owning_department_code, manager_person_id:manager?.person_id || null, status:record.status || existing?.status || 'active' };
  const error = message => errors.push({row, message});
  if (departments.some(d => key(d.code) === key(record.code))) error('该组织编码已被部门使用，请为办公室使用独立编码');
  if (existing && existing.org_type !== 'office') error('该组织编码已被其他组织层级使用，不能转换为办公室');
  if ((!department && !proposedDepartment) || (proposedDepartment?.status || department?.status || 'active') !== 'active') error('办公室的归口部门不存在或未启用');
  if (record.parent_code) error('办公室请使用归口部门编码，上级部门编码应留空');
  if (fields.manager_employee_no && record.manager_employee_no && (!manager || manager.status !== 'active' || manager.employment_status !== 'active')) error('办公室负责人必须是花名册中当前有效的在职人员');
  const pending = snapshot.pending.some(t => Number(t.office_id) === Number(existing?.org_unit_id));
  if (existing && Number(existing.department_id) !== Number(department?.id) && pending) error('办公室仍有未办结任务，请先办结后再调整归口部门');
  if (desired.status !== 'active' && existing && (pending || snapshot.memberships.some(m => Number(m.office_id) === Number(existing.org_unit_id) && m.status === 'active'))) error('办公室仍有有效成员或未办结任务，请先处理后再停用或归档');
  const before = existing ? {name:existing.org_unit_name,owning_department_code:departments.find(d => Number(d.id) === Number(existing.department_id))?.code || '',manager_employee_no:persons.find(p => Number(p.person_id) === Number(existing.manager_person_id))?.employee_no || '',status:existing.status} : {};
  const after = {name:desired.name,owning_department_code:desired.department_code,manager_employee_no:manager?.employee_no || '',status:desired.status};
  const changedFields = Object.keys(after).filter(f => String(before[f] || '') !== String(after[f] || '')).map(f => ({field:f,before:before[f] || '',after:after[f] || ''}));
  const same = Boolean(existing && !changedFields.length);
  return {errors,change:{entity:'office',existing,desired,same},review:{row,key:record.code,action:!existing?'added':same?'unchanged':'updated',fields:changedFields}};
}

function planMembership(record, fields, existing, snapshot, departments, row) {
  const errors = [], personId = Number(existing?.person_id);
  const before = snapshot.memberships.filter(m => Number(m.person_id) === personId && m.status === 'active').map(m => Number(m.office_id)).sort((a,b)=>a-b);
  let officeIds = before;
  if (fields.office_codes) {
    const codes = String(record.office_codes || '').split(/[;；、\n]/).map(key).filter(Boolean);
    if (new Set(codes).size !== codes.length) errors.push({row,message:'同一人员的办公室编码重复'});
    officeIds = codes.map(code => {
      const office = snapshot.offices.find(o => key(o.org_unit_code) === code && o.org_type === 'office');
      if (!office || office.status !== 'active' || !departments.some(d => Number(d.id) === Number(office.department_id) && d.status === 'active')) errors.push({row,message:'办公室编码 '+code+' 不存在、未启用或尚未明确归口部门'});
      return Number(office?.org_unit_id || 0);
    }).sort((a,b)=>a-b);
  }
  if (snapshot.pending.some(t => Number(t.assignee_person_id) === personId && (!officeIds.includes(Number(t.office_id)) || (record.employment_status && record.employment_status !== 'active')))) errors.push({row,message:'此人员还有办公室任务未办结，请先办结或由负责人重新分配后再调整'});
  if (record.employment_status && record.employment_status !== 'active' && snapshot.offices.some(o => o.org_type === 'office' && o.status === 'active' && Number(o.manager_person_id) === personId)) errors.push({row,message:'此人员仍是启用办公室的负责人，请先调整负责人后再变更在职状态'});
  const same = JSON.stringify(before) === JSON.stringify(officeIds);
  const names = ids => ids.map(id => snapshot.offices.find(o => Number(o.org_unit_id) === id)?.org_unit_code || id).join(';');
  return {errors,officeIds,membershipChanged:!same,review:same?null:{field:'office_codes',before:names(before),after:names(officeIds)}};
}

async function applyOffices(db, changes, actorId) {
  const [departments] = await db.query('SELECT id,code FROM departments');
  for (const change of changes.filter(c => c.entity === 'office' && !c.same)) {
    const row = change.desired, departmentId = departments.find(d => key(d.code) === key(row.department_code)).id;
    if (change.existing) await db.execute('UPDATE org_unit SET org_unit_name=?,department_id=?,manager_person_id=?,status=?,updated_by=? WHERE org_unit_id=?',[row.name,departmentId,row.manager_person_id,row.status,actorId,change.existing.org_unit_id]);
    else await db.execute("INSERT INTO org_unit(org_unit_code,org_unit_name,org_type,department_id,manager_person_id,status,created_by,updated_by) VALUES (?,?,'office',?,?,?,?,?)",[row.code,row.name,departmentId,row.manager_person_id,row.status,actorId,actorId]);
  }
}

async function applyMemberships(db, changes, actorId) {
  for (const change of changes.filter(c => c.membershipChanged)) {
    const [[person]] = await db.execute('SELECT person_id FROM person WHERE employee_no=?',[change.desired.employee_no]);
    await db.execute("UPDATE office_membership SET status='inactive',updated_by_person_id=? WHERE person_id=? AND status='active'",[actorId,person.person_id]);
    for (const officeId of change.officeIds) await db.execute("INSERT INTO office_membership(office_id,person_id,created_by_person_id,updated_by_person_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE status='active',updated_by_person_id=?",[officeId,person.person_id,actorId,actorId,actorId]);
  }
}
module.exports = {officeSnapshot,planOffice,planMembership,applyOffices,applyMemberships};
