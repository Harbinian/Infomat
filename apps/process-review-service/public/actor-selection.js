export function splitActorRole(value, roles) {
  const raw = String(value || '');
  const department = Object.keys(roles).sort((a, b) => b.length - a.length)
    .find(name => raw === name || raw.startsWith(name));
  if (!department) return { department: '', position: '', unresolved: raw };
  return { department, position: raw.slice(department.length).replace(/^[\s/／:：·-]+/, ''), unresolved: '' };
}

export function actorRoleValue(department, position) {
  return [department, position].filter(Boolean).join(' / ');
}

export function actorSelectionError(before, after, roles) {
  const value = after.current_actor_role || '';
  const changed = value !== (before.current_actor_role || '');
  const fixed = !after.actor_assignment_mode || after.actor_assignment_mode === 'fixed_department';
  const becameFixed = fixed && before.actor_assignment_mode && before.actor_assignment_mode !== 'fixed_department';
  if (!value || (!changed && !becameFixed)) return '';
  if (!fixed) return '按规则确定执行主体时，请保留原办理角色或清空，具体安排填写在部门分配规则中。';
  const actor = splitActorRole(value, roles);
  if (!actor.department || !roles[actor.department]?.includes(actor.position)) {
    return '请先选择执行部门，再选择该部门的执行岗位。原有输入已保留。';
  }
  return '';
}
