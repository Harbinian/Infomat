import assert from 'node:assert/strict';
import {
  DeliverableFsError,
  buildChangeLogTable,
  deliverableToFrontmatter,
  parseDeliverableFrontmatter,
  stringifyDeliverableFrontmatter,
  validateDeliverableFrontmatter,
} from '../gantt-react/src/utils/deliverableFrontmatter.js';

const SAMPLE = `---
deliverableId: DLV-001
title: 启动会议程和参会清单
status: 待评审
deliverableType: 过程记录类
deliverableLevel: C
department: 信息化项目组
plannedFinish: 2026-06-05
evidence:
  fileName: DLV-001-启动会议程和参会清单.md
  fileSize: 0
  fileType: text/markdown
  uploadedAt: 2026-06-20T09:00:00.000Z
  source: 占位登记(待补传原件)
workflowHistory:
  - action: submit
    label: 提交
    from: 未提交
    to: 已提交
    actor: 项目管理部
    at: 2026-06-20T09:00:00.000Z
    note: 提交初稿
  - action: startReview
    label: 进入评审
    from: 已提交
    to: 待评审
    actor: PMO
    at: 2026-06-20T10:00:00.000Z
    note: 进入 PMO 评审
---
# 启动会议程和参会清单

正文。

## 变更记录
| 版本 | 状态 | 动作 | 责任人 | 时间 | 备注 |
| --- | --- | --- | --- | --- | --- |
| V0.1 | 已提交 | 提交 | 项目管理部 | 2026-06-20 | 提交初稿 |
| V0.2 | 待评审 | 进入评审 | PMO | 2026-06-20 | 进入 PMO 评审 |
`;

const parsed = parseDeliverableFrontmatter(SAMPLE);
assert.equal(parsed.frontmatter.deliverableId, 'DLV-001');
assert.equal(parsed.frontmatter.status, '待评审');
assert.equal(parsed.frontmatter.workflowHistory.length, 2);
assert.ok(parsed.body.startsWith('# 启动会议程和参会清单'));
validateDeliverableFrontmatter(parsed.frontmatter);

const reparsed = parseDeliverableFrontmatter(stringifyDeliverableFrontmatter(parsed));
assert.deepEqual(reparsed.frontmatter, parsed.frontmatter);
assert.equal(reparsed.body.trim(), parsed.body.trim());

assert.throws(
  () => validateDeliverableFrontmatter({ deliverableId: 'DLV-001' }),
  error => error instanceof DeliverableFsError && error.code === 'SCHEMA_INVALID' && /status.*必填/.test(error.message),
);
assert.throws(
  () => validateDeliverableFrontmatter({
    deliverableId: 'DLV-001',
    title: 'x',
    status: '已废弃',
    deliverableType: '过程记录类',
    deliverableLevel: 'C',
    department: 'd',
    plannedFinish: '2026-06-05',
  }),
  /状态枚举越界/,
);
assert.throws(
  () => validateDeliverableFrontmatter({
    deliverableId: 'DLV-001',
    title: 'x',
    status: '待评审',
    deliverableType: '过程记录类',
    deliverableLevel: 'C',
    department: 'd',
    plannedFinish: '2026\/06\/05',
  }),
  /plannedFinish.*ISO/,
);

const noFm = parseDeliverableFrontmatter('# 标题\n\n正文。');
assert.deepEqual(noFm.frontmatter, {});
assert.equal(noFm.body, '# 标题\n\n正文。');

assert.doesNotThrow(() => validateDeliverableFrontmatter({
  deliverableId: 'DLV-002',
  title: 't',
  status: '未提交',
  deliverableType: '过程记录类',
  deliverableLevel: 'D',
  department: 'd',
  plannedFinish: '2026-06-05',
  evidence: null,
  workflowHistory: [],
}));

const table = buildChangeLogTable(parsed.frontmatter.workflowHistory);
assert.ok(table.includes('| V0.2 | 待评审 | 进入评审 | PMO | 2026-06-20 | 进入 PMO 评审 |'));

// ===== action 块（行动项）=====
// 关键回归点：gray-matter 会把裸日期解析成 Date 对象，必须递归归一化，
// 否则 round-trip 断言失败，且每次写回都把 YAML 漂移成完整 ISO 时间戳。

const ACTION_SAMPLE = `---
deliverableId: DLV-180
title: 行动项正本
status: 编制中
deliverableType: 方案规范类
deliverableLevel: B
department: MDM工作组
plannedFinish: 2026-10-09
action:
  assigneeDepartment: MDM工作组
  dueDate: 2026-10-15
  state: 待接收
  publishedAt: 2026-09-24T02:00:00.000Z
  publishedBy: PMO
  ackDueDate: 2026-09-25
  criteriaSource: task
---
# 行动项正本
`;

const actionParsed = parseDeliverableFrontmatter(ACTION_SAMPLE);
assert.equal(actionParsed.frontmatter.action.state, '待接收');
assert.equal(actionParsed.frontmatter.action.dueDate, '2026-10-15', 'action.dueDate 必须保持 ISO 日期文本');
assert.equal(actionParsed.frontmatter.action.ackDueDate, '2026-09-25');
validateDeliverableFrontmatter(actionParsed.frontmatter);

const actionReparsed = parseDeliverableFrontmatter(stringifyDeliverableFrontmatter(actionParsed));
assert.deepEqual(actionReparsed.frontmatter, actionParsed.frontmatter, 'action 块 round-trip 必须稳定');

// 未发布的正本不含 action；显式 null 会被清除
assert.equal('action' in parseDeliverableFrontmatter(SAMPLE).frontmatter, false, '既有正本不含 action 块');
const withNullAction = parseDeliverableFrontmatter(SAMPLE.replace('workflowHistory:', 'action: null\nworkflowHistory:'));
assert.equal('action' in withNullAction.frontmatter, false, 'action: null 应从 frontmatter 中移除');

// 条件校验：仅当 action 存在时生效，不能给旧正本增加必填负担
const baseForAction = {
  deliverableId: 'DLV-180',
  title: 't',
  status: '编制中',
  deliverableType: '方案规范类',
  deliverableLevel: 'B',
  department: 'd',
  plannedFinish: '2026-10-09',
};
assert.doesNotThrow(() => validateDeliverableFrontmatter(baseForAction), '无 action 时不得新增必填要求');
assert.throws(
  () => validateDeliverableFrontmatter({
    ...baseForAction,
    action: { assigneeDepartment: 'MDM工作组', dueDate: '2026-10-15', state: '已完结' },
  }),
  /action\.state 枚举越界/,
);
assert.throws(
  () => validateDeliverableFrontmatter({
    ...baseForAction,
    action: { assigneeDepartment: '', dueDate: '2026-10-15', state: '待接收' },
  }),
  /assigneeDepartment 必填/,
);
assert.throws(
  () => validateDeliverableFrontmatter({
    ...baseForAction,
    action: { assigneeDepartment: 'MDM工作组', dueDate: '2026/10/15', state: '待接收' },
  }),
  /action\.dueDate.*ISO/,
);

// 构建正本时透传 action
const builtWithAction = deliverableToFrontmatter({
  deliverableId: 'DLV-180',
  deliverableName: 't',
  deliverableStatus: '编制中',
  deliverableLevel: 'B',
  deliverableType: '方案规范类',
  department: 'd',
  plannedFinish: '2026-10-09',
  action: { assigneeDepartment: 'MDM工作组', dueDate: '2026-10-15', state: '待接收' },
});
assert.equal(builtWithAction.action.dueDate, '2026-10-15');

console.log('结果: frontmatter parse/stringify/validate/change-log/action 全分支通过');
