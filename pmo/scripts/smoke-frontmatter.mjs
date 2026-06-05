import assert from 'node:assert/strict';
import {
  DeliverableFsError,
  buildChangeLogTable,
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

console.log('结果: frontmatter parse/stringify/validate/change-log 全分支通过');
