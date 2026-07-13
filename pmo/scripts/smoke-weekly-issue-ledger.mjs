import assert from 'node:assert/strict';

import {
  WEEKLY_ISSUE_TYPES,
  buildWeeklyIssueSuggestions,
  createWeeklyIssueItem,
  getWeeklyIssueType,
  summarizeWeeklyIssueItems,
} from '../gantt-react/src/utils/weeklyIssueUtils.js';

const expectedTypes = ['action', 'risk', 'issue', 'change', 'responsibility'];

assert.deepEqual(
  WEEKLY_ISSUE_TYPES.map(type => type.key),
  expectedTypes,
  'weekly issue ledger should cover action, risk, issue, change, and responsibility templates'
);

for (const key of expectedTypes) {
  const type = getWeeklyIssueType(key);
  assert.ok(type.label, `${key} should have a visible label`);
  assert.ok(type.ledgerName, `${key} should have a ledger destination`);
  assert.ok(type.closeRule, `${key} should have a close rule`);
}

const riskItem = createWeeklyIssueItem({
  type: 'risk',
  title: '基础设施现场条件可能影响计划',
  owner: '基础设施工作组',
});
assert.equal(riskItem.ledgerName, '风险台账');
assert.equal(riskItem.closeCriteria, getWeeklyIssueType('risk').closeRule);
assert.equal(riskItem.status, 'open');

const suggestions = buildWeeklyIssueSuggestions({
  tasks: [
    { id: 1, wbs: '2.5.1', name: '基础设施现场确认', risk: '高', department: '基础设施工作组', finish: '2026-07-08' },
  ],
  deliverables: [
    {
      deliverableId: 'DLV-900',
      deliverableName: '延期样例交付物',
      deliverableLevel: 'A',
      plannedFinish: '2026-07-01',
      deliverableStatus: '编制中',
      department: 'PMO',
    },
  ],
  phaseGates: [
    { gateId: 'G0', gateName: '启动门', missing: ['项目启动令'] },
  ],
  pmoDate: new Date(2026, 6, 2),
});

assert.ok(suggestions.some(item => item.type === 'action' && item.sourceKey === 'W-A03'));
assert.ok(suggestions.some(item => item.type === 'risk' && item.sourceKey === 'task:1'));
assert.ok(suggestions.some(item => item.type === 'issue' && item.sourceKey === 'deliverable:DLV-900'));
assert.ok(suggestions.some(item => item.type === 'issue' && item.sourceKey === 'gate:G0'));

const summary = summarizeWeeklyIssueItems([
  riskItem,
  createWeeklyIssueItem({ type: 'issue', title: '阶段门缺资料', status: 'closed' }),
]);
assert.equal(summary.total, 2);
assert.equal(summary.open, 1);
assert.equal(summary.closed, 1);
assert.equal(summary.byType.risk, 1);
assert.equal(summary.byType.issue, 1);

console.log('weekly issue ledger smoke passed');
