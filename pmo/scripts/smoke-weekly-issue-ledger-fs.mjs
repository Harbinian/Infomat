// 用法: node pmo/scripts/smoke-weekly-issue-ledger-fs.mjs
//
// 校验周会事项台账的文件正本能力：
//   1. 规则校验纯函数 —— 6.4 关闭依据、8.1 期限调整同意人、8.2 保留逾期事实
//   2. 发布文本模板（与交付物行动项同源同格式）
//   3. 端到端 —— 登记、更新、If-Match 冲突、规则拒绝、台账落盘

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  applyWeeklyIssuePatch,
  createWeeklyIssueItem,
  isWeeklyIssueOverdue,
  summarizeWeeklyIssueItems,
} from '../gantt-react/src/utils/weeklyIssueUtils.js';
import { buildPublishTextForIssue } from '../gantt-react/src/utils/publishText.js';
import { parseRosterMarkdown } from '../gantt-react/src/utils/pmoRoster.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

// ===== 1. 规则校验纯函数 =====
const base = createWeeklyIssueItem({
  type: 'action',
  title: '补充调研资料',
  owner: '工程技术部',
  dueDate: '2026-10-15',
  closeCriteria: '资料回执确认',
});

assert.equal(base.status, 'open');
assert.equal(base.ledgerName, '行动项台账');
assert.equal(base.closeCriteria, '资料回执确认');
assert.equal(base.resultNote, '');
assert.deepEqual(base.history, []);

// 规则 6.4：没有结果或可核对依据的事项不得关闭
assert.throws(
  () => applyWeeklyIssuePatch(base, { status: 'closed', actor: 'PMO' }),
  /规则 6.4/,
);
assert.doesNotThrow(
  () => applyWeeklyIssuePatch(base, { status: 'closed', closureNote: '资料已回执确认', actor: 'PMO' }),
  '有关闭结论即可关闭',
);
assert.doesNotThrow(
  () => applyWeeklyIssuePatch(base, { resultNote: '清单已发工作群', status: 'closed', actor: 'PMO' }),
  '有办理结果即可关闭',
);

// 规则 8.1：期限调整必须记录同意人
assert.throws(
  () => applyWeeklyIssuePatch(base, { dueDate: '2026-10-20', actor: 'PMO' }),
  /规则 8.1/,
);

const rescheduled = applyWeeklyIssuePatch(base, { dueDate: '2026-10-20', approvedBy: '刘春含', actor: 'PMO' });
assert.equal(rescheduled.dueDate, '2026-10-20');
assert.equal(rescheduled.history.length, 1, '期限调整必须留下历史');
// 规则 8.2：调整生效，但不得追溯消除已经发生的逾期事实
assert.equal(rescheduled.history[0].from, '2026-10-15', '原截止时间必须保留在历史中');
assert.equal(rescheduled.history[0].approvedBy, '刘春含');

// 状态流转留痕
const doing = applyWeeklyIssuePatch(base, { status: 'doing', actor: 'PMO' });
assert.equal(doing.status, 'doing');
assert.equal(doing.history.at(-1).field, 'status');
assert.throws(() => applyWeeklyIssuePatch(base, { status: '不存在的状态' }), /未知状态/);

// 规则 8.2：逾期是派生态而非状态
assert.equal(isWeeklyIssueOverdue({ ...base, dueDate: '2026-09-01' }, new Date('2026-09-24')), true);
assert.equal(isWeeklyIssueOverdue({ ...base, dueDate: '2026-10-01' }, new Date('2026-09-24')), false);
assert.equal(isWeeklyIssueOverdue({ ...base, dueDate: '2026-09-01', status: 'closed' }, new Date('2026-09-24')), false);

const summary = summarizeWeeklyIssueItems([base, { ...base, id: 'W-TEST-2', status: 'closed' }]);
assert.equal(summary.total, 2);
assert.equal(summary.closed, 1);

// ===== 2. 发布文本 =====
const roster = parseRosterMarkdown(
  fs.readFileSync(path.join(repoRoot, 'pmo', '信息化项目_部门主备对接人名单.md'), 'utf8'),
);

const publishText = buildPublishTextForIssue(base, { roster });
assert.ok(publishText.includes('【行动项发布】补充调研资料'));
assert.ok(publishText.includes('责任方：工程技术部（主对接人：常云龙）'));
assert.ok(publishText.includes('截止时间：2026-10-15'));
assert.ok(publishText.includes('关闭标准：资料回执确认'));
assert.ok(publishText.includes('按《信息化项目协同工作规则》6.2'));
assert.equal(/等级|风险|WBS|供应商/.test(publishText), false, '发布文本不得携带 PMO 内部字段');

// 责任方不在名册内时不附联系人，也不输出空括号
const outsiderText = buildPublishTextForIssue({ ...base, owner: 'PMO' }, { roster });
assert.ok(outsiderText.includes('责任方：PMO'));
assert.equal(outsiderText.includes('（'), false);

// ===== 3. 端到端（隔离台账，不触碰仓库正本）=====
const root = path.resolve(scriptDir, '../gantt-react');
const ledgerDir = path.resolve(root, '../../artifacts/pmo/weekly-issues-smoke');
const ledgerFile = path.join(ledgerDir, 'ledger.json');
const requireFromApp = createRequire(path.join(root, 'package.json'));
const { createServer } = await import(pathToFileURL(requireFromApp.resolve('vite')).href);

process.env.PMO_WEEKLY_ISSUES_DIR = ledgerDir;
await fsp.rm(ledgerDir, { recursive: true, force: true });

const server = await createServer({
  configFile: path.join(root, 'vite.config.js'),
  root,
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  logLevel: 'silent',
});

try {
  await server.listen();
  const address = server.httpServer.address();
  const port = typeof address === 'object' ? address.port : 5173;
  const baseUrl = `http://127.0.0.1:${port}/api/pmo/weekly-issues`;
  const post = (url, body, headers = {}) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const put = (url, body, headers = {}) => fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  // 台账初始为空
  const initial = await fetch(baseUrl).then(response => response.json());
  assert.equal(initial.ok, true);
  assert.deepEqual(initial.data.items, []);

  // 登记
  const created = await post(baseUrl, {
    type: 'issue', title: '调研资料缺口', owner: '信息化项目组', dueDate: '2026-10-01',
  }).then(response => response.json());
  assert.equal(created.ok, true);
  assert.equal(created.data.item.status, 'open');
  assert.equal(created.data.item.ledgerName, '问题台账');
  const issueId = created.data.item.id;

  // 缺标题被拒
  const noTitle = await post(baseUrl, { type: 'action', title: '   ' });
  assert.equal(noTitle.status, 400, '空标题必须拒绝');

  // 落盘检查
  assert.ok(fs.existsSync(ledgerFile), '台账必须写入 ledger.json');
  const onDisk = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.items.length, 1);

  // 读取回来的台账带 mtime
  const reloaded = await fetch(baseUrl).then(response => response.json());
  assert.ok(reloaded.data.mtime > 0, '台账必须返回 mtime 供乐观锁使用');

  // 规则 6.4：无依据不得关闭
  const premature = await put(`${baseUrl}/${issueId}`, { status: 'closed', actor: 'PMO' });
  assert.equal(premature.status, 422);
  assert.match((await premature.json()).error.message, /规则 6.4/);

  // 登记结果
  const withResult = await put(`${baseUrl}/${issueId}`, {
    resultNote: '资料已由物资保障部补齐', actor: '信息化项目组',
  }).then(response => response.json());
  assert.equal(withResult.ok, true);
  assert.equal(withResult.data.item.resultNote, '资料已由物资保障部补齐');

  // 规则 8.1：期限调整需同意人
  const badDue = await put(`${baseUrl}/${issueId}`, { dueDate: '2026-10-10', actor: 'PMO' });
  assert.equal(badDue.status, 422);
  assert.match((await badDue.json()).error.message, /规则 8.1/);

  // 用登记结果之前的 mtime 发起写入 → 乐观锁必须拒绝，避免覆盖他人改动
  const staleDue = await put(`${baseUrl}/${issueId}`, {
    dueDate: '2026-10-10', approvedBy: '刘春含', actor: 'PMO',
  }, { 'If-Match': String(reloaded.data.mtime) });
  assert.equal(staleDue.status, 409, '陈旧的 If-Match 必须拒绝');

  const goodDue = await put(`${baseUrl}/${issueId}`, {
    dueDate: '2026-10-10', approvedBy: '刘春含', actor: 'PMO',
  }, { 'If-Match': String(withResult.data.mtime) }).then(response => response.json());
  assert.equal(goodDue.ok, true);
  assert.equal(goodDue.data.item.dueDate, '2026-10-10');
  assert.equal(goodDue.data.item.history.at(-1).from, '2026-10-01', '原截止时间保留在历史中');

  // 关闭
  const closed = await put(`${baseUrl}/${issueId}`, {
    status: 'closed', closureNote: '资料已回执，缺口关闭', actor: 'PMO',
  }, { 'If-Match': String(goodDue.data.mtime) }).then(response => response.json());
  assert.equal(closed.ok, true);
  assert.equal(closed.data.item.status, 'closed');

  // If-Match 陈旧 → 409
  const stale = await put(`${baseUrl}/${issueId}`, { note: 'x' }, { 'If-Match': '1' });
  assert.equal(stale.status, 409, '陈旧的 If-Match 必须拒绝');

  // 不存在的事项 → 404
  const missing = await put(`${baseUrl}/W-NOT-EXIST`, { note: 'x' });
  assert.equal(missing.status, 404);
} finally {
  await server.close();
  await fsp.rm(ledgerDir, { recursive: true, force: true });
  delete process.env.PMO_WEEKLY_ISSUES_DIR;
}

console.log('✓ 周会事项文件正本检查通过');
console.log('  规则 6.4·8.1·8.2 校验 / 发布文本 / 登记·更新·乐观锁 端到端');
