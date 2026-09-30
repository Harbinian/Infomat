// 用法: node pmo/scripts/smoke-deliverable-workflow.js
// 校验交付物状态流转、台账筛选排序、统计卡跳转意图的纯逻辑契约。

import assert from 'node:assert/strict';
import {
  applyDeliverableOverrides,
  createDashboardCardIntents,
  filterAndSortDeliverables,
  transitionDeliverableStatus,
  validateDeliverableOverrides,
} from '../gantt-react/src/utils/deliverableWorkflow.js';
import {
  mergeControlledWithBinding,
  resolveDeliverableBindings,
} from '../gantt-react/src/utils/deliverableUtils.js';

const baseDeliverable = {
  deliverableId: 'DLV-001',
  deliverableName: '总体蓝图',
  deliverableLevel: 'A',
  deliverableType: '方案规范类',
  department: '项目管理部',
  reviewer: 'PMO',
  plannedFinish: '2026-06-20',
  taskRisk: '高',
  deliverableStatus: '未提交',
};

const submitted = transitionDeliverableStatus(baseDeliverable, {
  action: 'submit',
  actor: '项目管理部',
  note: '提交初稿',
  at: '2026-06-18T09:00:00.000Z',
});

assert.equal(submitted.deliverableStatus, '已提交');
assert.equal(submitted._actualSubmitDate, '2026-06-18');
assert.equal(submitted.workflowHistory.length, 1);
assert.equal(submitted.workflowHistory[0].action, 'submit');

const approved = transitionDeliverableStatus(
  { ...submitted, deliverableStatus: '待评审', evidence: { fileName: 'DLV-001-总体蓝图.md' } },
  {
    action: 'approve',
    actor: 'PMO',
    note: '资料完整，审核通过',
    at: '2026-06-19T10:00:00.000Z',
  },
);

assert.equal(approved.deliverableStatus, '通过');
assert.equal(approved._actualPassDate, '2026-06-19');
assert.equal(approved.reviewOpinion, '资料完整，审核通过');

assert.throws(
  () => transitionDeliverableStatus(approved, { action: 'reject', actor: 'PMO', at: '2026-06-20T09:00:00.000Z' }),
  /不允许从“通过”执行“退回整改”/,
);

const overrides = validateDeliverableOverrides([
  {
    deliverableId: 'DLV-001',
    status: '待评审',
    actualSubmitDate: '2026-06-18',
    reviewer: 'PMO',
    reviewOpinion: '等待周会评审',
    workflowHistory: [{ action: 'submit', from: '未提交', to: '已提交', actor: '项目管理部', at: '2026-06-18T09:00:00.000Z', note: '提交初稿' }],
  },
]);

const merged = applyDeliverableOverrides([baseDeliverable], overrides);
assert.equal(merged[0].deliverableStatus, '待评审');
assert.equal(merged[0].reviewOpinion, '等待周会评审');
assert.equal(merged[0].workflowHistory.length, 1);

// ===== 绑定契约（2026-09 重构）=====
// 旧实现用「nodeKey / WBS / taskId / 文本重叠 / 日期相等」的五选一 OR 链合并正本与投影行，
// 导致 DLV-003 这类「共享 4 字」的巧合被错误合并、DLV-179 被内容无关的任务顶替。
// 新契约：绑定只认显式锚点；计划完成日期在绑定成功时以计划真源为准。

const boundTask = {
  id: 2,
  originalId: 2,
  wbs: '1.1.1',
  normalizedWbs: '1.1.1',
  nodeKey: '1.1.1__2',
  name: '项目启动会准备',
  deliverable: '启动会议程、参会清单',
  finish: '2026-06-20',
  deliverableId: 'DLV-001',
  completionCriteria: '清单齐套且责任明确',
  evidenceRequirements: '清单文件、确认记录',
};
const boundRecord = {
  fileName: 'DLV-001-启动会议程和参会清单.md',
  mtime: 0,
  body: '',
  frontmatter: {
    deliverableId: 'DLV-001',
    title: '昌兴复材数字化底座项目启动会议程与参会清单',
    status: '待评审',
    plannedFinish: '2026-06-05',
    deliverableType: '过程记录类',
    deliverableLevel: 'C',
    department: '信息化项目组',
  },
};

const resolved = resolveDeliverableBindings({ tasks: [boundTask], controlled: [boundRecord] });
assert.equal(resolved.bindings.get('DLV-001').bindingSource, 'task-field');

const boundRow = mergeControlledWithBinding(boundRecord, resolved.bindings.get('DLV-001'));
assert.equal(boundRow.deliverableStatus, '待评审', '正本状态优先');
assert.equal(boundRow.plannedFinish, '2026-06-20', '绑定成功时计划完成日期以计划真源为准');
assert.equal(boundRow.planFinishSource, 'task');
assert.equal(boundRow.completionCriteria, '清单齐套且责任明确', '完成判定由绑定任务只读带入');
assert.equal(boundRow.evidenceRequirements, '清单文件、确认记录');

// 无显式锚点时绝不靠文本相似度兜底 —— 这正是旧 OR 链的失效点
const unanchored = resolveDeliverableBindings({
  tasks: [{ ...boundTask, deliverableId: '' }],
  controlled: [boundRecord],
});
const unanchoredBinding = unanchored.bindings.get('DLV-001');
assert.equal(unanchoredBinding.bindingSource, 'none', '无显式锚点必须保持未绑定');
assert.equal(unanchoredBinding.taskId, null);
assert.ok(unanchored.issues.some(issue => issue.kind === 'UNBOUND_DELIVERABLE'));

const unboundRow = mergeControlledWithBinding(boundRecord, unanchoredBinding);
assert.equal(unboundRow.plannedFinish, '2026-06-05', '未绑定时退回正本自身日期');
assert.equal(unboundRow.planFinishSource, 'frontmatter');
assert.equal(unboundRow.completionCriteria, '', '未绑定时没有完成判定来源');

// 正本侧锚点同样生效（任务未声明受控编号时）
const frontmatterBound = resolveDeliverableBindings({
  tasks: [{ ...boundTask, deliverableId: '' }],
  controlled: [{ ...boundRecord, frontmatter: { ...boundRecord.frontmatter, normalizedWbs: '1.1.1' } }],
});
assert.equal(frontmatterBound.bindings.get('DLV-001').bindingSource, 'frontmatter');
assert.equal(frontmatterBound.bindings.get('DLV-001').taskId, 2);

const deliverables = [
  merged[0],
  {
    deliverableId: 'DLV-002',
    deliverableName: '接口联调报告',
    deliverableLevel: 'B',
    deliverableType: '测试联调类',
    department: '工程技术部',
    reviewer: '技术负责人',
    plannedFinish: '2026-06-10',
    taskRisk: '中',
    deliverableStatus: '未提交',
  },
  {
    deliverableId: 'DLV-003',
    deliverableName: '培训记录',
    deliverableLevel: 'C',
    deliverableType: '过程记录类',
    department: '行政人事部',
    reviewer: 'PMO',
    plannedFinish: '2026-07-05',
    taskRisk: '低',
    deliverableStatus: '已归档',
  },
];

const filtered = filterAndSortDeliverables(
  deliverables,
  { status: 'all', level: 'all', type: 'all', department: 'all', month: '2026-06', search: '' },
  { key: 'plannedFinish', direction: 'desc' },
);

assert.deepEqual(filtered.map(item => item.deliverableId), ['DLV-001', 'DLV-002']);

const cards = createDashboardCardIntents({
  tasks: [{ id: 1, risk: '高', isSummary: false, isMilestone: false }],
  deliverables,
  phaseGates: [{ gateId: 'G2', status: '风险' }],
  pmoDate: new Date('2026-06-25'),
});

const overdueCard = cards.find(card => card.key === 'overdueDeliverables');
assert.equal(overdueCard.value, 2);
assert.deepEqual(overdueCard.target, { page: 'pmo', pmoView: 'overdue' });

const gateRiskCard = cards.find(card => card.key === 'gateRisks');
assert.deepEqual(gateRiskCard.target, { page: 'pmo', pmoView: 'phasegates', gateStatus: '风险' });

console.log('结果: 交付物流转/筛选排序/统计卡跳转契约全部通过');
