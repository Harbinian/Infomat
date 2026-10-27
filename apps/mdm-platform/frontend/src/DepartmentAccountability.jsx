import { StatusPanel } from './components.jsx';

const reasons = {
  DEPARTMENT_ACCOUNTABILITY_POLICY_REQUIRED: '部门负责人办理规则尚未准备完成，请联系维护人员核对。',
  DEPARTMENT_INACTIVE: '责任部门已不可用，请联系行政人事核对部门记录。',
  DEPARTMENT_FINAL_RESPONSIBLE_UNSET: '尚未登记本部门最终负责人，不能最终确认。请联系行政人事核对责任安排与组织记录；本人角色授权及授权时的负责人登记，由管理员在“账号与授权办理”核对。',
  DEPARTMENT_FINAL_RESPONSIBLE_MISMATCH: '当前身份不是已登记的本部门负责人，不能代替负责人确认。',
  DEPARTMENT_PERSON_SCOPE_MISMATCH: '当前人员所属部门与责任部门不一致，不能办理本部门确认。',
  DEPARTMENT_ACCOUNTABILITY_ROLE_REQUIRED: '部门负责人尚缺本部门有效角色授权，不能最终确认。请联系管理员核对本人部门负责人角色及授权有效期。',
  DEPARTMENT_ACCOUNTABILITY_PERMISSION_REQUIRED: '部门负责人当前有效权限不完整，不能最终确认。请联系管理员核对当前授权，不由本页补授权限。',
  DEPARTMENT_ACCOUNTABILITY_ADMIN_READ_ONLY: '管理员仅查阅治理材料，不能代替部门负责人确认。',
  DEPARTMENT_ACCOUNTABILITY_ACTOR_INACTIVE: '当前人员或账号状态已不满足办理条件，不能最终确认。'
};

export const accountabilityFailureText = error => reasons[error?.code] || null;
export const accountabilitySnapshot = value => JSON.stringify(value ? [value.eligible, value.reason, value.policy_version, value.department_id, value.actor_person_id, value.final_responsible_person_id, value.role_assignment_id] : null);

export function DepartmentAccountability({ value, title = '部门负责人办理条件' }) {
  if (!value) return <StatusPanel title={title}>当前尚未取得负责人资格核验结果，不能据此认定有最终确认权。请刷新核对。</StatusPanel>;
  return <StatusPanel title={title}>{value.eligible === true
    ? '已核验当前本人为本部门已登记的最终负责人，且有效角色授权与权限齐备。每次提交仍核对最新资格及材料状态。'
    : reasons[value.reason] || '当前部门负责人办理条件尚未满足，请核对负责人记录及有效授权。'}</StatusPanel>;
}
