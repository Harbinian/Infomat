// A server fallback is a readable scope, never evidence of a user's choice.
export const sameOfficeId = (left, right) => String(left ?? '') === String(right ?? '');

export function initialOfficeSelection(draft, search = '') {
  if (draft && Object.hasOwn(draft, 'officeId')) return String(draft.officeId ?? '');
  return new URLSearchParams(search).get('office_id') || '';
}

export function officeWorkbenchSelection(result, requestedId) {
  const id = String(requestedId || '');
  const ready = Boolean(id && sameOfficeId(result?.selected_office_id, id)
    && result?.offices?.some(office => sameOfficeId(office.id, id)));
  return {
    ...result,
    office_selection_ready: ready,
    selected_office_id: ready ? id : null,
    // The response can contain the API's first office when no office was asked
    // for. Keep the choice list, but do not display its tasks as the selection.
    members: ready ? result.members : [],
    tasks: ready ? result.tasks : [],
    can_assign: ready && Boolean(result.can_assign)
  };
}

export function officeTargetChoices(data, task = null) {
  return (data?.offices || []).filter(office => office.status === 'active' && office.department_id
    && (!task?.to_dept_id || sameOfficeId(office.department_id, task.to_dept_id)));
}

export function explicitOfficeTarget(data, officeId, task = null) {
  return officeTargetChoices(data, task).some(office => sameOfficeId(office.id, officeId))
    ? String(officeId) : '';
}

export function officeTargetAvailable(data, targetId, task = null) {
  return Boolean(targetId && officeTargetChoices(data, task).some(office => sameOfficeId(office.id, targetId)));
}
