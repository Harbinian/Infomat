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
