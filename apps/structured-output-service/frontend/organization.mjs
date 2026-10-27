// The workbook-derived catalog constrains new selections, never rewrites imported facts.
export const departmentKeys = new Set(['owning_department', 'source_department', 'responsibility.department']);
export const roleValue = (department, position) => [department, position].filter(Boolean).join(' / ');
export function splitRole(value, roles = {}) {
  const raw = String(value || '');
  const department = Object.keys(roles).sort((a, b) => b.length - a.length).find(name => raw === name || raw.startsWith(name));
  if (!department) return { department: '', position: '', unresolved: raw };
  const position = raw.slice(department.length).replace(/^[\s/／:：·-]+/, '');
  return { department, position, unresolved: '' };
}
const options = values => values.map(value => ({ value, label: value }));
export function organizationField(field, enums = {}, entity = {}) {
  const roles = enums.rosterRolesByDepartment || {};
  const departments = Object.keys(roles);
  const manualPositions = enums.organizationCatalogMode === 'departments_only';
  if (departmentKeys.has(field.key)) return { ...field, editor: 'select', organization: true, options: [{ value: '', label: '尚未选择' }, ...options(departments)] };
  if (field.key === 'current_actor_role') return { ...field, editor: 'organization-role', organization: true, roles, manualPositions, options: [], readOnly: field.readOnly || entity.actor_assignment_mode && entity.actor_assignment_mode !== 'fixed_department' };
  if (field.key === 'responsibility.position') return manualPositions ? { ...field, editor: 'text', organization: true, manualPositions, options: [] } : { ...field, editor: 'select', organization: true, options: [{ value: '', label: '尚未选择' }, ...options(roles[entity.responsibility?.department] || [])] };
  if (field.key === 'countersign_target_departments') return { ...field, editor: 'multi-select', organization: true, options: options(departments) };
  return field;
}
export function organizationInputErrors(before, after, enums = {}) {
  const roles = enums.rosterRolesByDepartment || {}, departments = Object.keys(roles), errors = [];
  const manualPositions = enums.organizationCatalogMode === 'departments_only';
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const department = (previous, next, label) => {
    if (!same(previous, next) && next && !departments.includes(next)) errors.push(`${label}请选择员工基础信息表中的部门；原有输入已保留`);
  };
  department(before?.process?.owning_department, after?.process?.owning_department, '归属部门');
  for (const behavior of after?.behaviors || []) {
    const old = before?.behaviors?.find(item => item.behavior_ref === behavior.behavior_ref) || {};
    if (!same(old.current_actor_role, behavior.current_actor_role) && behavior.current_actor_role && (!behavior.actor_assignment_mode || behavior.actor_assignment_mode === 'fixed_department')) {
      const actor = splitRole(behavior.current_actor_role, roles);
      if (!actor.department || (!manualPositions && !roles[actor.department]?.includes(actor.position))) errors.push(manualPositions ? '执行部门请选择3000中的有效部门，岗位按实际填写待核对；原有输入已保留' : '执行部门与岗位请选择原表中的对应组合；原有输入已保留');
    }
    const previous = old.countersign_target_departments || [];
    for (const name of behavior.countersign_target_departments || []) if (!previous.includes(name) && !departments.includes(name)) errors.push('会签目标部门请选择员工基础信息表中的部门；原有输入已保留');
  }
  for (const data of after?.data_objects || []) {
    const old = before?.data_objects?.find(item => item.data_ref === data.data_ref);
    for (const source of data.source_relations || []) department(old?.source_relations?.find(item => item.source_ref === source.source_ref)?.source_department, source.source_department, '来源部门');
    for (const route of data.lifecycle?.routes || []) for (const event of route.events || []) {
      const previous = old?.lifecycle?.routes?.find(item => item.route_ref === route.route_ref)?.events?.find(item => item.event_ref === event.event_ref)?.responsibility || {};
      const next = event.responsibility || {};
      department(previous.department, next.department, '责任部门');
      if (!manualPositions && (!same(previous.department, next.department) || !same(previous.position, next.position)) && next.position && !roles[next.department]?.includes(next.position)) errors.push('责任岗位请选择责任部门在原表中的岗位；原有输入已保留');
    }
  }
  return [...new Set(errors)];
}
