const { activeActor } = require('./processV7Authoring');
const { readPersonAuthority } = require('./identityMysqlRepository');
const { sessionSubject, sameIdentityInteger: same } = require('./sessionSubject');
const { assertDepartmentAccountability, inspectDepartmentAccountability } = require('./departmentAccountability');
const { fail } = require('./terminologyGovernancePolicy');
function hasRole(current, code, permission, departmentId = null) {
  const rows = current.grants.filter(g => g.role_code === code &&
    (departmentId == null ? g.scope_type === 'global' : g.scope_type === 'department' && same(g.scope_department_id,departmentId)));
  const effective = current.grants.filter(g => g.scope_type !== 'department' || same(g.scope_department_id,current.current_department_id));
  return rows.some(g => g.perm_code === permission && g.effect === 'allow') &&
    !effective.some(g => g.perm_code === permission && g.effect === 'deny');
}
async function currentActor(db, session, write = false) {
  const subject = sessionSubject(session || {});
  if (subject.kind === 'system_admin') {
    if (write) throw fail('ADMIN_READ_ONLY','管理员对术语治理只读',403);
    return { personId:null,departmentId:null,roleCodes:new Set(['admin']),permissions:new Set(),readOnly:true,lead:false,contact:false };
  }
  // An effective employee account need not have a department to read the public
  // dictionary or raise a custom-definition challenge. It gains no department
  // authoring, confirmation or MDM authority from this observer path.
  if (session.departmentId == null) {
    const observer = await readPersonAuthority(db,session,subject.personId,{currentRead:write});
    if (!observer.valid || observer.user.employment_status !== 'active') throw fail('IDENTITY_CHANGED','身份或授权已变化，请重新登录',401);
    if (observer.user.current_department_id == null) {
      if (write && observer.readOnly) throw fail('ADMIN_READ_ONLY','管理员对术语治理只读',403);
      return {...session,personId:observer.user.personId,departmentId:null,readOnly:observer.readOnly,roleCodes:observer.roleCodes,
        permissions:observer.permissions,lead:false,contact:false,steward:false,decider:false};
    }
  }
  const current = await activeActor(db,session,write);
  if (session.departmentId != null && !same(session.departmentId,current.current_department_id)) throw fail('IDENTITY_CHANGED','部门已变化，请重新登录',401);
  if (write && current.admin) throw fail('ADMIN_READ_ONLY','管理员叠加业务角色仍对术语治理只读',403);
  const departmentId = current.current_department_id;
  return { ...session,personId:current.person_id,departmentId,readOnly:current.admin,
    globalRead:hasRole(current,'data_quality_auditor','governance:read-global'),
    roleCodes:new Set(current.grants.map(g => g.role_code)),permissions:new Set([...current.effects].filter(([,value]) => value === 'allow').map(([key]) => key)),
    lead: !current.admin && hasRole(current,'mdm_lead','governance:structure-gate') && hasRole(current,'mdm_lead','governance:publish'),
    contact: !current.admin && hasRole(current,'department_contact','governance:draft-department',departmentId) && hasRole(current,'department_contact','governance:submit-department',departmentId),
    steward: !current.admin && hasRole(current,'mdm_steward','governance:handle-assigned-work'),
    decider: !current.admin && hasRole(current,'decision_group','governance:decide-escalation') };
}
async function forTerm(db, who, row, write = false) {
  const [assigned] = who.personId ? await db.execute(`SELECT assignment_id FROM tg_assignments WHERE term_id=? AND assignee_person_id=? AND active=1${write ? ' FOR SHARE' : ''}`,[row.term_id,String(who.personId)]) : [[]];
  const assignment = assigned.length > 0;
  const final = who.personId && same(who.departmentId,row.department_id)
    ? await inspectDepartmentAccountability(db,who,row.department_id,{lock:write}) : {eligible:false};
  return {...who,assigned:assignment,operator:who.lead || (who.steward && assignment),finalResponsible:final.eligible};
}
async function assertFinal(db, who, departmentId) {
  return assertDepartmentAccountability(db,who,departmentId,{lock:true});
}
function canReadProcess(who,row) {
  return Boolean(who.lead || who.readOnly || (who.personId && same(who.personId,row.created_by_person_id)) ||
    ((who.contact || who.finalResponsible) && same(who.departmentId,row.department_id)) || (who.steward && who.assigned));
}
function assertContact(who,row = null) {
  if (!who.contact || (row && !same(who.departmentId,row.department_id))) throw fail('CONTACT_REQUIRED','须由本部门有效业务对接人提报，编制者身份不能替代',403);
}
module.exports = { currentActor,forTerm,assertFinal,canReadProcess,assertContact,hasRole };
