import { reviewProgress } from './processReviewPresentation.js';
import { businessText } from './businessPresentation.js';

const returned = item => item?.type === 'v7_returned' || item?.governanceType === 'v7_returned';
const scopeReview = item => item?.type === 'v7_scope' || item?.governanceType === 'v7_scope';
const identity = value => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value
  : Number.isSafeInteger(value) && value > 0 ? String(value) : null;
const same = (left, right) => left != null && right != null && String(left) === String(right);
const oldAction = '按退回原因上传新修订';
const oldSampleMarker = '。回3001修改并下载后，上传至案例 ';
const oldSampleEnd = '；受影响部门重新核对。';
const displayFields = item => ({ title: item.title, actionLabel: item.actionLabel, sample: item.sample, nextStep: item.nextStep,
  ...(item.handlingGuide ? { handlingGuide: item.handlingGuide } : {}) });
const authoringSteps = new Map([
  ['上传3001下载的未审核V7/V8', '在3000编制并保存未审核草稿，也可导入JSON草稿'],
  ['在3001补充或修订本部门流程事实后上传原案例', '在3000从原案例续修，保存并提交新修订后重新核对']
]);
export function authoringRolePresentation(role, enabled) {
  if (!enabled || role?.code !== 'department_contact' || !Array.isArray(role.workflow)) return role;
  return { ...role, workflow: role.workflow.map(step => authoringSteps.get(step) || step) };
}
function roleActionPresentation(item, enabled) {
  const contact = item?.roleCode === 'department_contact' || item?.roleHint === 'department_contact' || item?.id === 'guide:department_contact';
  const oldStep = '上传3001下载的未审核V7/V8';
  if (!enabled || !contact || typeof item.title !== 'string' || !item.title.endsWith('：' + oldStep)) return item;
  return { ...item, title: item.title.slice(0, -oldStep.length) + authoringSteps.get(oldStep) };
}
function projectionKey(item) {
  const fields = [item?.target, item?.title, item?.actionLabel, item?.sample];
  return fields.every(value => typeof value === 'string') && fields.slice(0, 3).every(Boolean) ? JSON.stringify(fields) : null;
}

function originalReturnBasis(sample) {
  if (typeof sample !== 'string') return '';
  const at = sample.lastIndexOf(oldSampleMarker);
  return at >= 0 && sample.endsWith(oldSampleEnd) ? sample.slice(0, at) : sample;
}

export function returnedItemPresentation(item, detail, authoringEnabled = false) {
  if (!returned(item)) return item;
  const matches = identity(item.caseId) && same(item.caseId, detail?.case?.id)
    && identity(item.revisionNo) && same(item.revisionNo, detail?.case?.current_revision_no)
    && typeof item.contentHash === 'string' && item.contentHash.length > 0
    && item.contentHash === detail?.case?.current_content_hash;
  const awaiting = matches && reviewProgress(detail)?.awaitingRecheck === true;
  const label = awaiting ? '已提交，查看负责人重新核对进度' : '查看修改意见与当前修订';
  const instruction = awaiting ? '原意见和历史保留，请进入案例查看当前修订的负责人核对进度。'
    : authoringEnabled ? '原意见和历史保留，请进入案例查看修改意见与当前修订；如需修改，可按当前授权在3000从原案例续修，保存并提交新修订后重新核对。'
      : '原意见和历史保留，请进入案例查看修改意见与当前修订；如需修改，完成修订后上传原案例。';
  const basis = originalReturnBasis(item.sample);
  const suffix = typeof item.title === 'string' && item.title.startsWith(oldAction + '：') ? item.title.slice(oldAction.length) : '';
  return { ...item, title: label + suffix, actionLabel: label, nextStep: label,
    sample: basis + (basis && !/[。！？!?；]\s*$/.test(basis) ? '。' : '') + instruction };
}

// Legacy scope entries remain read-only even if an old response advertises a
// retired action. Current tasks come from the governed submission/time workflow.
export function scopeItemPresentation(item, detail) {
  if (!scopeReview(item)) return item;
  const matches = identity(item.caseId) && same(item.caseId, detail?.case?.id)
    && identity(item.revisionNo) && same(item.revisionNo, detail.case.current_revision_no)
    && typeof item.contentHash === 'string' && item.contentHash.length > 0
    && item.contentHash === detail.case.current_content_hash;
  if(matches&&detail.governance?.schema_ready)return {...item,title:'查看本流程材料、部门确认与办理时限',actionLabel:'查看本流程当前办理事项',nextStep:'查看材料、部门确认与办理时限',
    sample:'本流程按提交材料、部门本人确认及约定时限办理，不使用旧范围决定入口。请打开“本次核对”查看当前允许的动作；办理记录在“优化建议、制度版次与历史记录”查阅。',
    handlingGuide:{actor:'按当前事项显示的有权人员办理',operation:'打开本流程的“本次核对”，查看材料是否齐备、相关部门本人确认及办理时限；返回工作台刷新，进入当前实际待办。',result:'在本流程“确认结果”“办理截止日期”及“优化建议、制度版次与历史记录”查看已保存结果。',handoff:'材料未齐备时由归口主对接人补齐，组长不代填或代确认。'}};
  const label = '查看本流程归口与参与范围';
  const processName = matches ? businessText(detail.case.process_name, '流程名称暂无法展示') : '';
  const actor = '按当前事项显示的有权人员办理';
  const operation = '打开本流程核对已保存的归口和参与范围。原归口与范围直接登记入口已经停用；材料未齐备时由归口主对接人补齐，材料及办理功能尚未准备时保持查阅，不重复尝试原操作。';
  const result = '在本流程“责任与历史”查阅已保存记录；取得当前材料办理条件后，返回工作台刷新并查看实际待办。';
  const incomplete = matches && (detail.governance?.submission?.missing?.length || !detail.governance?.submission
    || (detail.governance?.blocking_issues || []).some(issue => ['PROCESS_CASE_SUBMISSION_INCOMPLETE', 'PROCESS_CASE_PARTICIPANTS_PENDING'].includes(issue.code)));
  const handoff = incomplete ? '提交材料或参与范围尚未齐备时，由归口部门当前有效的主对接人补齐；组长不代填材料或代替部门确认。保存后在“阅读本次提交材料”和“核对本部门责任范围”查看。' : '';
  return { ...item, title: label + (processName ? '：' + processName : ''), actionLabel: '查看本流程归口与范围办理位置', nextStep: label,
    sample: operation + result + handoff, handlingGuide: { actor, operation, result, handoff } };
}

const handoffItem = item => item?.sourceType === 'data_map_handoff' || item?.governanceType === 'data_map_handoff';

// Names come only from the caller's authorized fixed-source package read.
// Missing names stay explicit; the original identifier and target remain intact.
export function handoffWorkItemPresentation(item, context) {
  if (!handoffItem(item)) return item;
  const matches = (context?.packages || []).filter(row => same(row.package_id, item.package_id));
  const sourceName = matches.length === 1 ? businessText(matches[0].document_title, '来源流程名称未提供') : '来源名称尚未读取，请进入本事项核对';
  const namedSource = ['data_map_handoff_draft', 'data_map_handoff_package'].includes(item.type);
  return {...item, title: namedSource ? `${businessText(item.actionLabel, '查看承接事项')}：${sourceName}`
    : businessText(item.title, '事项名称暂无法展示，请进入本事项核对')};
}

// The server already filters by current qualification. Use its one aggregate
// count, never add older department todos or the separate handoff read to it.
export function currentWorkbenchSnapshot(data) {
  const count = data?.summary?.actionableCount;
  if (!Number.isSafeInteger(count) || count < 0 || !Array.isArray(data.workItems)) throw new Error('当前办理事项未能完整读取，请刷新核对；不能据此判断没有事项。');
  const seen = new Set(), items = [];
  for (const item of data.workItems) {
    if (item.type === 'guidance' || item.canAct === false) continue;
    const key = item.id == null ? null : String(item.type || '') + ':' + String(item.id);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    items.push(item);
  }
  if (items.length !== count) throw new Error('当前事项数量与清单不一致，请刷新核对；原有记录保持。');
  const isHandoff = item => item.sourceType === 'data_map_handoff' || item.governanceType === 'data_map_handoff';
  return { count, items, otherItems: items.filter(item => !isHandoff(item)), handoffCount: items.filter(isHandoff).length };
}

const canceled = () => Object.assign(new Error('工作台读取已取消。'), { name: 'AbortError' });

// Authorized detail reads only refine presentation. Original API records and
// negative opinions remain unchanged; absent or stale evidence stays neutral.
export async function loadWorkbenchReviewPresentation(api, data, { signal, isCurrent = () => !signal?.aborted } = {}) {
  const items = [...(data?.nextActions || []), ...(data?.workItems || [])].filter(item => returned(item) || scopeReview(item));
  const hasHandoffs = (data?.workItems || []).some(handoffItem);
  const knownProjection = item => item?.actionLabel === oldAction;
  const hasRoleGuidance = data?.roles?.some(role => role.code === 'department_contact' && role.workflow?.some(step => authoringSteps.has(step)));
  if (!items.length && !(data?.nextActions || []).some(knownProjection) && !hasRoleGuidance && !hasHandoffs) return data;
  const current = () => !signal?.aborted && isCurrent();
  if (!current()) throw canceled();
  const handoffRead = hasHandoffs ? api.request('/api/data-map-handoffs/workbench', {signal}).catch(() => null) : Promise.resolve(null);
  const ids = [...new Set(items.map(item => identity(item.caseId)).filter(Boolean))].slice(0, 200);
  const details = new Map();
  const status = api.request('/api/process-authoring/status', { signal }).catch(() => null);
  for (let start = 0; start < ids.length; start += 8) {
    if (!current()) throw canceled();
    const batch = ids.slice(start, start + 8);
    const values = await Promise.allSettled(batch.map(id => api.request('/api/process-v7-preview/cases/' + encodeURIComponent(id), { signal })));
    if (!current()) throw canceled();
    values.forEach((value, index) => { if(value.status === 'fulfilled')details.set(batch[index], value.value); });
  }
  const authoringEnabled = (await status)?.enabled === true;
  const handoff = await handoffRead;
  if (!current()) throw canceled();
  const present = item => handoffWorkItemPresentation(roleActionPresentation(scopeItemPresentation(returnedItemPresentation(item, details.get(identity(item.caseId)), authoringEnabled), details.get(identity(item.caseId))), authoringEnabled), handoff);
  const sources = new Map();
  for (const item of data.workItems || []) {
    const key = (returned(item) || scopeReview(item)) && projectionKey(item);
    if (key) sources.set(key, [...(sources.get(key) || []), item]);
  }
  const presentAction = action => {
    const sourceMatches = (data.workItems || []).filter(item => handoffItem(item) && item.target === action.target && item.title === action.title);
    if (sourceMatches.length === 1) return {...action, title: present(sourceMatches[0]).title};
    if ((returned(action) || scopeReview(action)) && identity(action.caseId) && identity(action.revisionNo) && action.contentHash) return present(action);
    const key = projectionKey(action), matches = key ? sources.get(key) || [] : [];
    if (matches.length === 1) return { ...action, ...displayFields(present(matches[0])) };
    if (scopeReview(action) || action?.actionLabel === '核对归口与范围依据') {
      return { ...action, ...displayFields(scopeItemPresentation({ ...action, type: 'v7_scope' }, null)) };
    }
    if (matches.length || returned(action) || knownProjection(action)) {
      const neutral = returnedItemPresentation({ ...action, type: 'v7_returned' }, null, authoringEnabled);
      return { ...action, ...displayFields(neutral) };
    }
    return roleActionPresentation(action, authoringEnabled);
  };
  return { ...data, roles: hasRoleGuidance && authoringEnabled ? data.roles.map(role => authoringRolePresentation(role, true)) : data.roles, nextActions: (data.nextActions || []).map(presentAction), workItems: (data.workItems || []).map(present) };
}
