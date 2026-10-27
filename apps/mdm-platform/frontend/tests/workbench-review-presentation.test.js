import test from 'node:test';
import assert from 'node:assert/strict';
import { authoringRolePresentation, loadWorkbenchReviewPresentation, returnedItemPresentation } from '../src/workbenchReviewPresentation.js';

const oldAction = '按退回原因上传新修订';
const originalBasis = '合成部门：请保留原意见，补充完成标准';
const item = (caseId = '9007199254740993') => ({ id: 'v7_returned:' + caseId, type: 'v7_returned', governanceType: 'v7_returned',
  caseId, revisionNo: 2, contentHash: 'fixed-hash', currentStatus: 'needs_revision', source: 'CASE-A',
  title: oldAction + '：合成流程', actionLabel: oldAction, nextStep: oldAction, target: '/app/process-preview?case=' + caseId,
  sample: originalBasis + '。回3001修改并下载后，上传至案例 CASE-A；受影响部门重新核对。', opaque: { unchanged: true } });
function detail(caseId = '9007199254740993') {
  return { case: { id: caseId, status: 'needs_revision', current_revision_id: 12, current_revision_no: 2, current_content_hash: 'fixed-hash' },
    revision: { id: 12, revision_no: 2, content_hash: 'fixed-hash', created_at: '2026-10-21T03:52:02.000Z' },
    items: [{ id: 22, case_id: caseId, revision_id: 12, revision_no: 2, carry_state: 'carried_forward', carried_from_item_id: 11,
      origin_status: 'needs_changes', origin_basis: originalBasis, origin_decided_at: '2026-10-21T03:49:52.000Z', counterparty_status: 'pending' }], events: [] };
}
const projected = source => ({ title: source.title, roleCode: 'department_contact', target: source.target, actionLabel: source.actionLabel,
  sample: source.sample, sourceRoles: ['department_contact'], requiredPermissions: [], priority: 1 });

test('exactly bound resubmitted returned cards show recheck progress and preserve original basis, records and targets', () => {
  const row = item(), source = detail(), before = structuredClone({ row, source });
  const display = returnedItemPresentation(row, source, true);
  assert.equal(display.actionLabel, '已提交，查看负责人重新核对进度');
  assert.equal(display.nextStep, display.actionLabel); assert.equal(display.title, display.actionLabel + '：合成流程');
  assert.equal(display.sample, originalBasis + '。原意见和历史保留，请进入案例查看当前修订的负责人核对进度。');
  assert.equal(display.target, row.target); assert.equal(display.currentStatus, row.currentStatus); assert.equal(display.opaque, row.opaque);
  assert.deepEqual({ row, source }, before);
});

test('case, revision and hash mismatches, unavailable detail and fresh negative opinions all remain neutral', () => {
  for (const patch of [{ caseId: '2' }, { revisionNo: 3 }, { contentHash: 'other-hash' }, { contentHash: '' }, { caseId: 9007199254740992 }]) {
    assert.equal(returnedItemPresentation({ ...item(), ...patch }, detail(), true).actionLabel, '查看修改意见与当前修订');
  }
  const current = detail(); current.items[0].origin_decided_at = '2026-10-21T03:55:00.000Z';
  assert.equal(returnedItemPresentation(item(), current, true).actionLabel, '查看修改意见与当前修订');
  assert.equal(returnedItemPresentation(item(), null, false).actionLabel, '查看修改意见与当前修订');
  assert.ok(returnedItemPresentation(item(), null, true).sample.includes('在3000从原案例续修'));
  assert.ok(!returnedItemPresentation(item(), null, false).sample.includes('在3000'));
  assert.ok(returnedItemPresentation(item(), null, false).sample.includes('完成修订后上传原案例'));
});

test('only the known generated suffix is replaced; original quoted history and unrelated work items stay intact', () => {
  const row = item();
  const basis = '原依据曾记载：回3001修订，并需保留其历史原文';
  row.sample = basis + '。回3001修改并下载后，上传至案例 CASE-A；受影响部门重新核对。';
  assert.ok(returnedItemPresentation(row, detail()).sample.startsWith(basis + '。'));
  const unrelated = { type: 'v7_preview_review', title: '核对事实', sample: '原始说明', target: '/app/process-preview?case=2' };
  assert.equal(returnedItemPresentation(unrelated, detail(), true), unrelated);
  const alias = { ...row, type: 'custom', governanceType: 'v7_returned' };
  assert.equal(returnedItemPresentation(alias, detail()).actionLabel, '已提交，查看负责人重新核对进度');
});

test('both workbench views use deduplicated authorized detail reads with the same signal and neutral failures', async () => {
  const row = item(), other = item('2'), unrelated = { type: 'other', title: '其他事项' };
  const data = { nextActions: [row, other], workItems: [row, unrelated, other], roles: [{ code: 'role' }], summary: { actionableCount: 3 } };
  const before = structuredClone(data), calls = [], signal = new AbortController().signal;
  const result = await loadWorkbenchReviewPresentation({ request: async (url, options) => {
    calls.push({ url, options }); assert.equal(options.signal, signal);
    if (url.endsWith('/status')) return { enabled: true };
    if (url.endsWith('/2')) throw Object.assign(new Error('denied'), { status: 403 });
    return detail();
  } }, data, { signal });
  assert.equal(calls.filter(call => call.url.includes('/cases/')).length, 2);
  assert.ok(calls.some(call => call.url.endsWith('/9007199254740993')));
  assert.equal(result.nextActions[0].actionLabel, '已提交，查看负责人重新核对进度');
  assert.equal(result.workItems[0].actionLabel, result.nextActions[0].actionLabel);
  assert.equal(result.nextActions[1].actionLabel, '查看修改意见与当前修订');
  assert.equal(result.workItems[1], unrelated); assert.equal(result.roles, data.roles); assert.equal(result.summary, data.summary);
  assert.deepEqual(data, before);
});

test('the actual metadata-free nextActions projection uses only its unique exact workItems source binding', async () => {
  const source = item('1'), action = projected(source), data = { nextActions: [action], workItems: [source] }, before = structuredClone(data);
  assert.equal(action.type, undefined); assert.equal(action.caseId, undefined); assert.equal(action.revisionNo, undefined); assert.equal(action.contentHash, undefined);
  const result = await loadWorkbenchReviewPresentation({ request: async url => url.endsWith('/status') ? { enabled: true } : detail('1') }, data);
  const displayed = result.nextActions[0];
  assert.equal(displayed.actionLabel, '已提交，查看负责人重新核对进度');
  assert.equal(displayed.title, result.workItems[0].title); assert.equal(displayed.sample, result.workItems[0].sample);
  assert.equal(displayed.nextStep, result.workItems[0].nextStep);
  for(const key of ['roleCode', 'target', 'sourceRoles', 'requiredPermissions', 'priority'])assert.equal(displayed[key], action[key]);
  for(const key of ['type', 'governanceType', 'caseId', 'revisionNo', 'contentHash', 'currentStatus'])assert.equal(displayed[key], undefined);
  assert.deepEqual(data, before);
});

test('ambiguous projected sources cannot borrow recheck evidence even when one exact source is confirmed awaiting', async () => {
  const first = item('1'), second = { ...first, id: 'other', revisionNo: 3, contentHash: 'another-hash' };
  const action = projected(first), data = { nextActions: [action], workItems: [first, second] }, before = structuredClone(data);
  const result = await loadWorkbenchReviewPresentation({ request: async url => url.endsWith('/status') ? { enabled: true } : detail('1') }, data);
  assert.equal(result.workItems[0].actionLabel, '已提交，查看负责人重新核对进度');
  assert.equal(result.nextActions[0].actionLabel, '查看修改意见与当前修订');
  assert.ok(result.nextActions[0].sample.startsWith(originalBasis + '。'));
  assert.ok(!result.nextActions[0].sample.includes('回3001修改并下载后'));
  assert.equal(result.nextActions[0].target, action.target); assert.deepEqual(data, before);
});

test('an unmatched known legacy projection becomes neutral without deriving case identity from its target or title', async () => {
  for(const changed of [null, { title: oldAction + '：同名流程的另一标题' }, { target: '/app/process-preview?case=2' }, { sample: '另一条依据。回3001修改并下载后，上传至案例 CASE-A；受影响部门重新核对。' }]) {
    const source = item('1'), action = { ...projected(source), ...changed }, calls = [];
    const data = { nextActions: [action], workItems: changed ? [source] : [] };
    const result = await loadWorkbenchReviewPresentation({ request: async url => { calls.push(url); return url.endsWith('/status') ? { enabled: false } : detail('1'); } }, data);
    assert.equal(result.nextActions[0].actionLabel, '查看修改意见与当前修订');
    assert.ok(!result.nextActions[0].sample.includes('回3001修改并下载后'));
    assert.ok(result.nextActions[0].sample.includes('完成修订后上传原案例'));
    assert.equal(result.nextActions[0].target, action.target);
    if(!changed)assert.deepEqual(calls, ['/api/process-authoring/status']);
  }
});

test('detail lookup is bounded to 200 unique cases and eight concurrent reads', async () => {
  const rows = Array.from({ length: 201 }, (_, index) => item(String(index + 1)));
  let active = 0, maximum = 0, count = 0;
  const result = await loadWorkbenchReviewPresentation({ request: async url => {
    if(url.endsWith('/status'))return { enabled: false };
    count += 1; active += 1; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 0)); active -= 1;
    return detail(url.split('/').at(-1));
  } }, { nextActions: rows.slice(0, 3), workItems: rows });
  assert.equal(count, 200); assert.ok(maximum <= 8);
  assert.equal(result.workItems[199].actionLabel, '已提交，查看负责人重新核对进度');
  assert.equal(result.workItems[200].actionLabel, '查看修改意见与当前修订');
});

test('late detail reads after mode replacement or abort cannot publish presentation or schedule another batch', async () => {
  for(const mode of ['generation', 'abort']) {
    let current = true, release, calls = 0;
    const controller = new AbortController(), pending = new Promise(resolve => { release = resolve; });
    const operation = loadWorkbenchReviewPresentation({ request: async url => {
      if(url.endsWith('/status'))return { enabled: true };
      calls += 1; await pending; return detail(url.split('/').at(-1));
    } }, { workItems: Array.from({ length: 9 }, (_, index) => item(String(index + 1))) }, { signal: controller.signal, isCurrent: () => current });
    if(mode === 'generation')current = false; else controller.abort();
    release(); await assert.rejects(operation, { name: 'AbortError' }); assert.equal(calls, 8);
  }
});

test('workbenches without returned items make no additional reads or presentation copies', async () => {
  const data = { nextActions: [{ type: 'other' }], workItems: [] };
  const result = await loadWorkbenchReviewPresentation({ request: async () => { throw new Error('unexpected read'); } }, data);
  assert.equal(result, data);
});

test('known role workflow guidance follows the enabled authoring path even without returned cases and preserves the role contract', async () => {
  const role = { code: 'department_contact', workflow: ['上传3001下载的未审核V7/V8', '在3001补充或修订本部门流程事实后上传原案例', '答复定向业务事实问题'], permissions: [{ code: 'original-permission' }], sample: '原业务事实示例' };
  const before = structuredClone(role), calls = [];
  const data = { roles: [role], nextActions: [], workItems: [] };
  const result = await loadWorkbenchReviewPresentation({ request: async url => { calls.push(url); return { enabled: true }; } }, data);
  assert.deepEqual(calls, ['/api/process-authoring/status']);
  assert.deepEqual(result.roles[0].workflow, ['在3000编制并保存未审核草稿，也可导入JSON草稿', '在3000从原案例续修，保存并提交新修订后重新核对', '答复定向业务事实问题']);
  assert.equal(result.roles[0].permissions, role.permissions); assert.equal(result.roles[0].sample, role.sample);
  assert.equal(authoringRolePresentation(role, false), role);
  const other = { ...role, code: 'other' }; assert.equal(authoringRolePresentation(other, true), other);
  assert.deepEqual(role, before);
});

test('generated fallback and full-view role guidance titles follow the same enabled step without changing original records', async () => {
  const title = '部门主对接人：上传3001下载的未审核V7/V8';
  const role = { code: 'department_contact', workflow: ['上传3001下载的未审核V7/V8'] };
  const action = { title, roleCode: 'department_contact', target: '/app/process-preview', sample: '原示例', actionLabel: '原入口' };
  const guidance = { ...action, id: 'guide:department_contact', type: 'guidance', roleHint: 'department_contact', nextStep: '原步骤' };
  const data = { roles: [role], nextActions: [action], workItems: [guidance] }, before = structuredClone(data);
  for (const enabled of [true, false]) {
    const result = await loadWorkbenchReviewPresentation({ request: async () => ({ enabled }) }, data);
    const expected = enabled ? '部门主对接人：在3000编制并保存未审核草稿，也可导入JSON草稿' : title;
    assert.equal(result.nextActions[0].title, expected); assert.equal(result.workItems[0].title, expected);
    assert.equal(result.nextActions[0].sample, action.sample); assert.equal(result.nextActions[0].target, action.target);
    assert.equal(result.workItems[0].nextStep, guidance.nextStep); assert.deepEqual(data, before);
  }
});
