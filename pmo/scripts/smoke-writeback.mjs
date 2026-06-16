import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _internal, applyTransitionToFile } from '../gantt-react/plugins/pmoDeliverablesPlugin.js';
import { parseDeliverableFrontmatter } from '../gantt-react/src/utils/deliverableFrontmatter.js';
import { transitionDeliverableStatus } from '../gantt-react/src/utils/deliverableWorkflow.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const versionedHistoryRoot = path.join(repoRoot, 'pmo', 'deliverables', '_history');
assert.ok(_internal.HISTORY_DIR.startsWith(path.join(repoRoot, 'artifacts', 'pmo', 'deliverables')));
assert.notEqual(_internal.HISTORY_DIR, versionedHistoryRoot);

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'pmo-writeback-'));
const filePath = path.join(tmp, 'DLV-201-写回测试.md');
const historyRoot = path.join(tmp, '_history');

fs.writeFileSync(filePath, `---
deliverableId: DLV-201
title: 写回测试
status: 已提交
deliverableType: 过程记录类
deliverableLevel: C
department: 测试部门
reviewer: PMO
plannedFinish: 2026-06-05
actualSubmitDate: 2026-06-05
evidence:
  fileName: seed.md
  fileSize: 10
  fileType: text/markdown
  uploadedAt: 2026-06-05T09:00:00.000Z
  source: 测试
workflowHistory:
  - action: submit
    label: 提交
    from: 未提交
    to: 已提交
    actor: 测试部门
    at: 2026-06-05T09:00:00.000Z
    note: 初稿
---
# 写回测试

正文。

## 变更记录
| 版本 | 状态 | 动作 | 责任人 | 时间 | 备注 |
| --- | --- | --- | --- | --- | --- |
| V0.1 | 已提交 | 提交 | 测试部门 | 2026-06-05 | 初稿 |
`);

try {
  const inMemory = transitionDeliverableStatus({
    deliverableId: 'DLV-201',
    deliverableName: '写回测试',
    deliverableStatus: '已提交',
    evidence: { fileName: 'seed.md' },
    workflowHistory: [],
  }, {
    action: 'startReview',
    actor: 'PMO',
    note: '进入评审',
    at: '2026-06-05T10:00:00.000Z',
  });
  assert.equal(inMemory.deliverableStatus, '待评审');

  const r1 = await applyTransitionToFile(filePath, {
    action: 'startReview',
    actor: 'PMO',
    note: '进入评审',
    at: '2026-06-05T10:00:00.000Z',
  }, { historyRoot });
  assert.ok(r1.mtime > 0);

  const afterReview = parseDeliverableFrontmatter(fs.readFileSync(filePath, 'utf8'));
  assert.equal(afterReview.frontmatter.status, '待评审');
  assert.equal(afterReview.frontmatter.workflowHistory.length, 2);
  assert.ok(afterReview.body.includes('| V0.2 | 待评审 | 进入评审 | PMO | 2026-06-05 | 进入评审 |'));

  await applyTransitionToFile(filePath, {
    action: 'approve',
    actor: 'PMO',
    note: '资料完整',
    at: '2026-06-05T11:00:00.000Z',
  }, { historyRoot });

  const afterApprove = parseDeliverableFrontmatter(fs.readFileSync(filePath, 'utf8'));
  assert.equal(afterApprove.frontmatter.status, '通过');
  assert.equal(afterApprove.frontmatter.actualPassDate, '2026-06-05');
  assert.equal(afterApprove.frontmatter.reviewOpinion, '资料完整');
  assert.ok(afterApprove.body.includes('| V0.3 | 通过 | 审核通过 | PMO | 2026-06-05 | 资料完整 |'));
  assert.equal(fs.readdirSync(path.join(historyRoot, 'DLV-201')).filter(name => name.includes('snapshot')).length, 1);

  const beforeIllegal = fs.readFileSync(filePath, 'utf8');
  await assert.rejects(
    () => applyTransitionToFile(filePath, {
      action: 'reject',
      actor: 'PMO',
      at: '2026-06-05T12:00:00.000Z',
    }, { historyRoot }),
    /不允许从“通过”执行“退回整改”/,
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), beforeIllegal);

  console.log('结果: 状态写回/frontmatter/body 变更记录/快照/非法跃迁保护全部通过');
} finally {
  await fsp.rm(tmp, { recursive: true, force: true });
}
