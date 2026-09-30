// 用法: node pmo/scripts/smoke-deliverable-action.mjs
//
// 校验交付物行动项能力：
//   1. 名册解析与工作日派生（规则 6.2）
//   2. 双轴状态机（status 轴不变 + action.state 轴独立演进）
//   3. 规则内置校验：6.4 关闭需可核对依据、8.1 期限调整同意人
//   4. 发布文本模板（严格 6.3 四要素，不带 PMO 内部字段）
//   7. 七个行动项端点的端到端行为

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DELIVERABLE_ACTIONS,
  applyDeliverableCommand,
  applyDeliverableEvent,
  canApplyDeliverableEvent,
  transitionDeliverableStatus,
} from '../gantt-react/src/utils/deliverableWorkflow.js';
import {
  APPROVERS,
  addWorkingDays,
  parseRosterMarkdown,
  rosterDepartments,
} from '../gantt-react/src/utils/pmoRoster.js';
import { buildPublishText, buildPublishTextForItem } from '../gantt-react/src/utils/publishText.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

// ===== 1. 名册与工作日 =====
const rosterMarkdown = fs.readFileSync(path.join(repoRoot, 'pmo', '信息化项目_部门主备对接人名单.md'), 'utf8');
const roster = parseRosterMarkdown(rosterMarkdown);
assert.equal(roster.length, 9, '名册应解析出 9 个部门');

const departments = rosterDepartments(roster);
assert.ok(departments.includes('工程技术部'));
assert.equal(departments.includes('MDM工作组'), false, 'MDM工作组 是编制归属，不是业务责任部门');

// 同意人姓名必须真实出现在协同工作规则正文中，防止硬编码漂移
const rulesMarkdown = fs.readFileSync(path.join(repoRoot, 'pmo', '信息化项目_协同工作规则.md'), 'utf8');
for (const name of [...APPROVERS.normal, ...APPROVERS.gate]) {
  assert.ok(rulesMarkdown.includes(name), `同意人 ${name} 必须出现在协同工作规则正文中`);
}

// 2026-09-24 周四 → +1 工作日 = 2026-09-25 周五；2026-09-25 周五 → 跳过周末 = 2026-09-28 周一
assert.equal(addWorkingDays('2026-09-24', 1), '2026-09-25');
assert.equal(addWorkingDays('2026-09-25', 1), '2026-09-28');
assert.equal(addWorkingDays('bad-input', 1), '');

// ===== 2. 双轴状态机 =====
const baseDeliverable = {
  deliverableId: 'DLV-180',
  deliverableName: '行动项测试',
  deliverableStatus: '未提交',
  evidence: null,
  workflowHistory: [],
};

assert.equal(canApplyDeliverableEvent(null, 'publish'), true);
assert.equal(canApplyDeliverableEvent(null, 'acknowledge'), false, '未发布不得直接接收');
assert.equal(canApplyDeliverableEvent(null, 'close'), false, '未发布不得直接关闭');

const published = applyDeliverableEvent(baseDeliverable, {
  action: 'publish',
  assigneeDepartment: '工程技术部',
  dueDate: '2026-10-15',
  actor: 'PMO',
  at: '2026-09-24T02:00:00.000Z',
}, { departments });

assert.equal(published.action.state, '待接收');
assert.equal(published.action.ackDueDate, '2026-09-25', '规则 6.2 的 1 个工作日应固化为 ackDueDate');
assert.equal(published.deliverableStatus, '未提交', '发布不得改动交付物自身的 status 轴');
assert.equal(published.workflowHistory.at(-1).action, 'publish');
assert.equal(published.workflowHistory.at(-1).from, '未发布');

// 责任部门必须在主备对接人名单内
assert.throws(
  () => applyDeliverableEvent(baseDeliverable, {
    action: 'publish', assigneeDepartment: '不存在部门', dueDate: '2026-10-15', actor: 'PMO',
  }, { departments }),
  /不在主备对接人名单内/,
);

const acked = applyDeliverableEvent(published, {
  action: 'acknowledge', actor: '常云龙', at: '2026-09-25T01:00:00.000Z',
});
assert.equal(acked.action.state, '已接收');
assert.throws(
  () => applyDeliverableEvent(acked, { action: 'acknowledge', actor: '常云龙' }),
  /不允许从“已接收”执行/,
  '状态机不得接受重复接收',
);

// 规则 6.4：没有结果或可核对依据的事项不得关闭
assert.throws(
  () => applyDeliverableEvent(acked, { action: 'close', closureNote: '完成', actor: 'PMO' }),
  /缺少可核对依据/,
);

// 有凭证时无 resultNote 也可关闭
assert.doesNotThrow(() => applyDeliverableEvent(
  { ...acked, evidence: { fileName: 'DLV-180-行动项测试.md' } },
  { action: 'close', closureNote: '凭证齐全', actor: 'PMO' },
));

const submitted = applyDeliverableEvent(acked, {
  action: 'submitResult', resultNote: '清单已发工作群', actor: '常云龙', at: '2026-10-01T01:00:00.000Z',
});
assert.equal(submitted.action.state, '已提交待确认');
assert.throws(
  () => applyDeliverableEvent(acked, { action: 'submitResult', resultNote: '  ', actor: '常云龙' }),
  /必须填写结果或材料位置/,
);

const closed = applyDeliverableEvent(submitted, {
  action: 'close', closureNote: '材料齐全，确认关闭', actor: 'PMO', at: '2026-10-02T01:00:00.000Z',
});
assert.equal(closed.action.state, '已关闭');
assert.equal(closed.deliverableStatus, '未提交', '行动项关闭不得改动 status 轴');
assert.equal(applyDeliverableEvent(submitted, { action: 'reopen', actor: 'PMO' }).action.state, '已接收');

// 规则 8.1：期限调整同意人
assert.throws(
  () => applyDeliverableEvent(acked, {
    action: 'changeDueDate', dueDate: '2026-10-20', scope: 'normal', approvedBy: '马成文', actor: 'PMO',
  }),
  /需由 刘春含 同意/,
);
assert.throws(
  () => applyDeliverableEvent(acked, {
    action: 'changeDueDate', dueDate: '2026-10-20', scope: 'gate', approvedBy: '刘春含', actor: 'PMO',
  }),
  /需由 马成文 或 李洪哲 同意/,
);

const rescheduled = applyDeliverableEvent(acked, {
  action: 'changeDueDate',
  dueDate: '2026-10-20',
  scope: 'normal',
  approvedBy: '刘春含',
  actor: 'PMO',
  note: '资源冲突，决策组同意',
  at: '2026-10-10T01:00:00.000Z',
});
assert.equal(rescheduled.action.dueDate, '2026-10-20');
assert.equal(rescheduled.action.state, '已接收', '期限调整不得改动承接状态');
assert.equal(rescheduled.workflowHistory.length, acked.workflowHistory.length + 1, '期限调整必须留下历史');

// status 轴行为完全不变，且单一分派入口可同时处理两轴
assert.equal(DELIVERABLE_ACTIONS.submit.to, '已提交');
assert.equal(
  transitionDeliverableStatus({ ...baseDeliverable, evidence: { fileName: 'x' } }, { action: 'submit', actor: 'A' }).deliverableStatus,
  '已提交',
);
assert.equal(applyDeliverableCommand(baseDeliverable, { action: 'submit', actor: 'A' }).deliverableStatus, '已提交');
assert.equal(
  applyDeliverableCommand(baseDeliverable, { action: 'publish', assigneeDepartment: '工程技术部', dueDate: '2026-10-15' }, { departments }).action.state,
  '待接收',
);
assert.throws(() => applyDeliverableCommand(baseDeliverable, { action: '不存在的动作' }), /未知交付物动作/);

// ===== 3. 发布文本 =====
const publishText = buildPublishText({
  items: [{
    deliverableId: 'DLV-180',
    deliverableName: '行动项测试',
    action: { assigneeDepartment: '工程技术部', dueDate: '2026-10-15', criteria: '', evidenceRequirement: '' },
    completionCriteria: '清单齐套且责任明确',
    evidenceRequirements: '清单文件、确认记录',
  }],
  actor: '张广懿',
  date: '2026-09-24',
  roster,
});

assert.ok(publishText.includes('【行动项发布】DLV-180 行动项测试'));
assert.ok(publishText.includes('责任部门：工程技术部（主对接人：常云龙）'));
assert.ok(publishText.includes('截止时间：2026-10-15'));
assert.ok(publishText.includes('完成判定：清单齐套且责任明确'), 'criteria 为空时应回落绑定任务的完成判定');
assert.ok(publishText.includes('按《信息化项目协同工作规则》6.2'));
assert.ok(publishText.includes('—— PMO 张广懿 2026-09-24'));
assert.equal(/等级|风险|WBS|供应商/.test(publishText), false, '发布文本不得携带 PMO 内部字段');

// 主对接人空缺时只输出部门名（经营发展部当前主对接人未填）
const noContactText = buildPublishTextForItem({
  deliverableId: 'DLV-181',
  deliverableName: '无联系人',
  action: { assigneeDepartment: '经营发展部', dueDate: '2026-10-15' },
}, { roster });
assert.ok(noContactText.includes('责任部门：经营发展部'));
assert.equal(noContactText.includes('（'), false, '联系人空缺时不得输出空括号');

// ===== 4. 端点端到端 =====
const root = path.resolve(scriptDir, '../gantt-react');
const deliverablesDir = path.resolve(root, '../deliverables');
const fixturePath = path.join(deliverablesDir, 'DLV-202-行动项端点测试.md');
const runtimeRoot = path.resolve(root, '../../artifacts/pmo/deliverables/test-deliverable-action');
const requireFromApp = createRequire(path.join(root, 'package.json'));
const { createServer } = await import(pathToFileURL(requireFromApp.resolve('vite')).href);

process.env.PMO_DELIVERABLE_RUNTIME_DIR = runtimeRoot;
await fsp.rm(runtimeRoot, { recursive: true, force: true });
await fsp.rm(path.join(deliverablesDir, '_history', 'DLV-202'), { recursive: true, force: true });

fs.writeFileSync(fixturePath, `---
deliverableId: DLV-202
title: 行动项端点测试
status: 未提交
deliverableType: 过程记录类
deliverableLevel: C
department: 信息化项目组
plannedFinish: 2026-10-09
workflowHistory: []
---
# 行动项端点测试
`);

const { pmoDeliverablesPlugin } = await import(pathToFileURL(path.join(root, 'plugins/pmoDeliverablesPlugin.js')).href);

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
  const base = `http://127.0.0.1:${port}/api/pmo/deliverables`;
  const post = (url, body, headers = {}) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  const rosterResponse = await fetch(`${base}/roster`).then(response => response.json());
  assert.equal(rosterResponse.ok, true);
  assert.equal(rosterResponse.data.length, 9, 'GET /roster 应返回 9 个部门');

  const publishResponse = await post(`${base}/DLV-202/publish`, {
    assigneeDepartment: '工程技术部',
    dueDate: '2026-10-15',
    actor: 'PMO',
    at: '2026-09-24T02:00:00.000Z',
  }).then(response => response.json());
  assert.equal(publishResponse.ok, true);
  assert.equal(publishResponse.data.state, '待接收');
  assert.ok(publishResponse.data.snapshotPath, '发布应生成快照留档');

  const republish = await post(`${base}/DLV-202/publish`, {
    assigneeDepartment: '工程技术部', dueDate: '2026-10-16', actor: 'PMO',
  });
  assert.equal(republish.status, 422, '已发布且未关闭时不得重复发布');

  // 未接收时关闭由状态机拦下
  const earlyClose = await post(`${base}/DLV-202/close`, { closureNote: '关闭', actor: 'PMO' });
  assert.equal(earlyClose.status, 422);
  assert.match((await earlyClose.json()).error.message, /不允许从“待接收”执行/);

  const acknowledged = await post(`${base}/DLV-202/acknowledge`, { actor: '常云龙' }).then(response => response.json());
  assert.equal(acknowledged.data.state, '已接收');

  // 规则 6.4：已接收但既无结果也无凭证，仍不得关闭
  const prematureClose = await post(`${base}/DLV-202/close`, { closureNote: '关闭', actor: 'PMO' });
  assert.equal(prematureClose.status, 422);
  assert.match((await prematureClose.json()).error.message, /缺少可核对依据/, '规则 6.4 必须在服务端生效');

  const wrongApprover = await post(`${base}/DLV-202/due-date`, {
    dueDate: '2026-10-20', scope: 'normal', approvedBy: '马成文', actor: 'PMO',
  });
  assert.equal(wrongApprover.status, 422, '规则 8.1 同意人校验必须在服务端生效');

  const rescheduled2 = await post(`${base}/DLV-202/due-date`, {
    dueDate: '2026-10-20', scope: 'normal', approvedBy: '刘春含', actor: 'PMO', note: '资源冲突',
  }).then(response => response.json());
  assert.equal(rescheduled2.data.state, '已接收', '期限调整不得改动承接状态');

  await post(`${base}/DLV-202/submit-result`, { resultNote: '清单已发工作群', actor: '常云龙' });
  const done = await post(`${base}/DLV-202/close`, { closureNote: '材料齐全，确认关闭', actor: 'PMO' })
    .then(response => response.json());
  assert.equal(done.data.state, '已关闭');

  const raw = await fetch(`${base}/DLV-202/raw`).then(response => response.text());
  assert.ok(raw.includes('state: 已关闭'), 'action 块必须写回正本');
  assert.ok(raw.includes('发布行动项') && raw.includes('确认关闭'), '变更记录必须包含行动项事件');

  const archive = await post(`${base}/publish-text`, { text: publishText }).then(response => response.json());
  assert.equal(archive.ok, true);
  assert.ok(fs.existsSync(path.join(runtimeRoot, archive.data.path)), '发布文本应归档到运行目录');
} finally {
  await server.close();
  await fsp.rm(fixturePath, { force: true });
  await fsp.rm(path.join(deliverablesDir, '_history', 'DLV-202'), { recursive: true, force: true });
  await fsp.rm(runtimeRoot, { recursive: true, force: true });
}

console.log('✓ 行动项契约检查通过');
console.log('  双轴状态机 / 规则 6.2·6.4·8.1 校验 / 发布文本 / 7 个端点');
