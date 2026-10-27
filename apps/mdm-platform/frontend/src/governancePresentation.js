import { businessStatus, businessText } from './businessPresentation.js';

// Counts are data, not server messages. Unknown values must never imply zero.
export function governanceCount(state, value) {
  if (state.busy) return '读取中…';
  if (state.error) return '暂不可用';
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : '数量待核对';
}

export const governanceLabel = (value, labels, fallback = '状态待核对') =>
  labels[value] || businessStatus(value, fallback);

export function auditActorName(event) {
  if (event.actor_name) return businessText(event.actor_name, '历史操作人姓名未记录');
  // This field is an explicit event link to an independent maintenance account.
  if (/^[1-9]\d*$/.test(String(event.actor_system_account_id ?? ''))) return '系统维护管理员（历史姓名未记录）';
  return '历史操作人姓名未记录';
}

// The drawing model keeps its references; only the painted labels are projected.
export function protectDiagramLabels(cy) {
  cy.elements().forEach(element => {
    const label = element.data('label');
    if (typeof label === 'string' && label) element.data('label', businessText(label, '名称或说明待核对'));
  });
}
