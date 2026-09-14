const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const start = html.indexOf('    function markPdgInputsClean()');
const end = html.indexOf('    async function pdgReloadCurrent()', start);
assert.ok(start > 0 && end > start);

function fixture() {
  let inputs = [];
  const logout = { disabled: false };
  const state = { processDataGovernance: { dirty: false } };
  const context = vm.createContext({
    state,
    location: { hash: '#/processGovernance?workspace=dataGovernance&package=1' },
    document: { querySelectorAll: selector => selector.includes('[data-pdg-dirty]') ? inputs : [...inputs, logout] },
    showConfirm: async () => false
  });
  vm.runInContext(html.slice(start, end), context);
  function render(values) {
    inputs = Object.entries(values).map(([id, value]) => ({ id, value, dataset: {}, disabled: false }));
    context.markPdgInputsClean();
  }
  const input = id => inputs.find(item => item.id === id);
  function edit(id, value) { input(id).value = value; state.processDataGovernance.dirty = true; }
  return { context, state, render, input, edit, logout };
}

(async () => {
  const f = fixture();
  f.render({ decision: '', review: '', untouched: 'old' });
  f.edit('decision', 'saved decision');
  f.edit('review', 'unsaved review');
  await f.context.runPdgAction(async () => {
    assert.equal(f.input('decision').disabled, true);
    assert.equal(f.logout.disabled, true);
    await assert.rejects(f.context.runPdgAction(async () => {}), /正在处理当前操作/);
    f.render({ decision: 'saved decision', review: '', untouched: 'new server value' });
  }, ['decision']);
  assert.equal(f.input('decision').value, 'saved decision');
  assert.equal(f.input('review').value, 'unsaved review');
  assert.equal(f.input('untouched').value, 'new server value', 'do not replace refreshed unchanged fields with old values');
  assert.equal(f.state.processDataGovernance.dirty, true);
  assert.equal(f.state.processDataGovernance.busy, false);
  assert.equal(f.logout.disabled, false);

  await f.context.runPdgAction(async () => f.render({ decision: 'saved decision', review: '', untouched: 'new server value' }));
  assert.equal(f.input('review').value, 'unsaved review', 'generation or refresh must preserve unsaved inputs');

  await assert.rejects(f.context.runPdgAction(async () => { throw new Error('synthetic request failure'); }, ['decision']), /synthetic request failure/);
  assert.equal(f.input('review').value, 'unsaved review');
  assert.equal(f.input('review').disabled, false);
  assert.equal(f.state.processDataGovernance.dirty, true);

  let completed = false;
  await f.context.runPdgAction(async () => { completed = true; }, ['decision'], true);
  assert.equal(completed, false, 'cancel completion while other drafts exist');
  assert.equal(f.input('review').value, 'unsaved review');
  f.context.showConfirm = async () => true;
  await f.context.runPdgAction(async () => { completed = true; f.render({}); }, ['decision'], true);
  assert.equal(completed, true);
  assert.equal(f.state.processDataGovernance.dirty, false);

  const loadStart = html.indexOf('    async function loadProcessGovernanceView(');
  const loadEnd = html.indexOf('    async function renderProcessGovernance()', loadStart);
  assert.ok(loadStart > 0 && loadEnd > loadStart);
  let route = { pdgPackageId: '' };
  let resolveList;
  const rendered = [];
  const loader = vm.createContext({
    state: { pgViewCache: {}, pgViewRequests: {}, processDataGovernance: { dirty: false, busy: false } },
    PROCESS_GOVERNANCE_VIEW_PRODUCTS: { dataGovernance: { load: () => new Promise(resolve => { resolveList = resolve; }) } },
    parseHash: () => route,
    processGovernanceViewFilters: () => ({}),
    processGovernanceLoadKey: (_view, filters) => filters.pdgPackageId || 'list',
    processGovernanceViewFromRoute: () => 'dataGovernance',
    renderProcessGovernanceView: (_view, payload) => rendered.push(payload),
    setProcessGovernanceViewLoading: () => {},
    setProcessGovernanceViewError: () => {}
  });
  vm.runInContext(html.slice(loadStart, loadEnd), loader);
  const pendingList = loader.loadProcessGovernanceView('dataGovernance');
  route = { pdgPackageId: '1' };
  loader.state.pgViewCache['1'] = { package: 1 };
  await loader.loadProcessGovernanceView('dataGovernance');
  resolveList({ stale: 'list' });
  assert.equal(await pendingList, null);
  assert.equal(rendered.length, 1, 'an earlier list response must not close a package reopened from cache');

  const pendingPackage = loader.loadProcessGovernanceView('dataGovernance', { force: true });
  route = { pdgPackageId: '2' };
  resolveList({ stale: 'package 1' });
  assert.equal(await pendingPackage, null, 'late response must match the exact active package or fact route');
  assert.equal(rendered.length, 1);

  const pendingEditRefresh = loader.loadProcessGovernanceView('dataGovernance', { force: true });
  loader.state.processDataGovernance.dirty = true;
  resolveList({ stale: 'before edit' });
  assert.equal(await pendingEditRefresh, null, 'background read must not replace inputs edited while it was in flight');
  assert.equal(rendered.length, 1);
  console.log('Process data governance editing behavior tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
