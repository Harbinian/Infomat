// Execute the retained page's read adapter with request/DOM doubles; no live IO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const start = source.indexOf('async function loadV7PreviewReviewView(');
const end = source.indexOf('function v7PreviewDecisionLabel(', start);
function adapter(request) {
  const context = vm.createContext({ api: request, state: { pgSelectedV7PreviewCaseId: 7 } });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.load = loadV7PreviewReviewView;', context);
  return context.load;
}

test('disabled preview stops before any case list or detail request', async () => {
  const calls = [];
  const load = adapter(async path => { calls.push(path); return { enabled: false }; });
  const result = await load({}, { v7CaseId: 7 });
  assert.deepEqual(calls, ['/api/process-v7-preview/status']);
  assert.equal(result.disabled, true);
  assert.equal(result.detail, null);
});

test('enabled preview still reads the current list and selected revision', async () => {
  const calls = [];
  const load = adapter(async path => { calls.push(path); return path.endsWith('/status') ? { enabled: true } : { synthetic: true }; });
  const result = await load({}, { v7CaseId: 7 });
  assert.deepEqual(calls, ['/api/process-v7-preview/status', '/api/process-v7-preview/cases?limit=100', '/api/process-v7-preview/cases/7']);
  assert.equal(result.detail.synthetic, true);
});

test('status read failure propagates and cannot masquerade as an empty list', async () => {
  const load = adapter(async () => { throw new Error('synthetic status failure'); });
  await assert.rejects(load({}, {}), /synthetic status failure/);
});

test('retained disabled view captures visible opinions before hiding its stale detail', () => {
  const elements = new Map([
    ['opinion', { isConnected: true, value: '合成未提交依据' }],
    ['pgV7EditNotice', {}], ['pgCreateV7PreviewBtn', {}],
    ['pgV7PreviewCaseRows', {}], ['pgV7PreviewDetail', { innerHTML: 'synthetic existing editor' }],
    ...['pgV7PreviewCaseCount', 'pgV7PreviewMyActionCount', 'pgV7PreviewCompleteCount', 'pgV7PreviewRevisionNo'].map(id => [id, {}])
  ]);
  const edits = { fields: {}, controls: { opinion: { id: 'opinion', baseline: '', label: '核对依据' } } };
  const context = vm.createContext({ $: id => elements.get(id), v7Edits: edits, safeText: value => String(value || '') });
  for (const [begin, finish] of [
    ['function captureV7Edits()', 'function hasV7Edits()'],
    ['function renderV7EditNotice()', 'function bindV7Editors('],
    ['function renderV7PreviewReviewView(', 'async function readV7PreviewFile(']
  ]) {
    const from = source.indexOf(begin), to = source.indexOf(finish, from);
    assert(from > 0 && to > from);
    vm.runInContext(source.slice(from, to), context);
  }
  vm.runInContext('renderV7PreviewReviewView({disabled:true});', context);
  assert.equal(edits.fields.opinion.value, '合成未提交依据');
  assert.equal(elements.get('pgV7PreviewDetail').innerHTML, 'synthetic existing editor');
  assert.equal(elements.get('pgV7PreviewDetail').hidden, true);
  assert.equal(elements.get('pgCreateV7PreviewBtn').hidden, true);
  assert.equal(elements.get('pgV7PreviewCaseCount').textContent, '—');
  assert.match(elements.get('pgV7PreviewCaseRows').innerHTML, /尚未开启/);
  assert.match(elements.get('pgV7EditNotice').innerHTML, /合成未提交依据/);
});
