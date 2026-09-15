const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
function source(start, end) {
  const offset = html.indexOf(start);
  assert.ok(offset >= 0 && html.indexOf(end, offset) > offset);
  return html.slice(offset, html.indexOf(end, offset));
}
const controls = [{ disabled: false }];
const nodes = {
  dataMapWriteActions: { hidden: true, querySelectorAll: () => controls },
  dataMapContextDept: { value: '', disabled: false },
  dataMapContextSelect: { value: '1' },
  dataMapImportButton: { disabled: false },
  dataMapAccessNotice: { textContent: '' }
};
const state = { user: { departmentId: 91, permissions: [] }, dataMapContexts: [{ id: 1, dept_id: 91 }], departments: [{ id: 91, name: '合成甲部' }] };
let writes = 0;
const context = vm.createContext({ state, $: id => nodes[id], hasPermission: code => state.user.permissions.includes(code), showToast: () => {}, api: () => { writes++; }, console });
vm.runInContext(source('    function updateDataMapAccess()', '    async function loadDataMapContexts()'), context);
vm.runInContext(source('    async function createDataMapContext()', '    async function renderDataMapFields()'), context);
vm.runInContext(source('    function workbenchActionableCount(', '    // ===== Toast system ====='), context);

(async () => {
  assert.equal(context.workbenchActionableCount({ workItems: [{ type: 'guidance' }] }), 0);
  assert.equal(context.workbenchActionableCount({ workItems: [{ type: 'guidance' }, { type: 'todo' }, { type: 'todo' }] }), 2);
  assert.equal(context.workbenchActionableCount({ summary: { actionableCount: 8 }, workItems: [] }), 8);
  assert.equal(context.workbenchActionableCount({}), null);
  // Read access must never turn into a write affordance or send a request.
  assert.equal(context.updateDataMapAccess(), false);
  assert.equal(nodes.dataMapWriteActions.hidden, true);
  assert.equal(controls[0].disabled, true);
  await context.createDataMapContext();
  assert.equal(writes, 0);
  state.user.permissions = ['governance:draft-department'];
  assert.equal(context.updateDataMapAccess(), true);
  assert.equal(nodes.dataMapWriteActions.hidden, false);
  assert.equal(nodes.dataMapContextDept.value, '91');
  assert.equal(nodes.dataMapContextDept.disabled, true);
  assert.equal(nodes.dataMapImportButton.disabled, false);
  state.dataMapContexts[0].dept_id = 92;
  context.updateDataMapAccess();
  assert.equal(nodes.dataMapImportButton.disabled, true, 'cross-department import remains unavailable');
  assert.equal(context.conflictDepartmentName('', 91), '合成甲部');
  assert.match(context.conflictDepartmentName('', 99), /待补充/);
  assert.equal(context.conflictSubject({ field_name_a: '订单号', field_name_b: '订单号', conflict_field: 'field_type' }), '订单号 · 字段类型');
  assert.match(context.conflictSubject({ conflict_field: 'field_type' }), /字段名称待补充/);
  assert.equal(context.qualityStatusLabel('unchecked'), '未检查');
  assert.match(context.qualityStatusLabel('future_status'), /future_status/, 'unknown values remain inspectable');
  assert.equal(context.todoContentLabel({ content: '用户原始说明' }), '用户原始说明');
  assert.equal(context.todoContentLabel({ content: 'Field conflict #2 coordination due 2026-06-23' }), '字段冲突 #2 待协调，截止日期：2026-06-23');
  let keydown;
  let queries = 0;
  vm.runInNewContext(source("      var searchInput = document.getElementById('personSearch');", "      var n2 = document.getElementById('personNewBtn');"), {
    document: { getElementById: () => ({ addEventListener: (event, handler) => { keydown = handler; } }) },
    loadPersons: () => { queries++; }
  });
  keydown({ key: 'Enter', isComposing: true, preventDefault() { throw Error('must preserve IME'); } });
  keydown({ key: 'Enter', keyCode: 229, preventDefault() { throw Error('must preserve legacy IME'); } });
  assert.equal(queries, 0);
  keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(queries, 1);
  // Only the exact workspace leaf is current; grouping must not create a second selection.
  function navNode(dataset, tagName = 'BUTTON') {
    const classes = new Set();
    const attributes = {};
    return { dataset, tagName, classes, attributes,
      classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
      setAttribute: (name, value) => { attributes[name] = value; },
      removeAttribute: name => { delete attributes[name]; } };
  }
  const group = { open: false };
  const links = [navNode({ tab: 'processGovernance' }, 'SUMMARY'),
    ...['v7Preview', 'handoffs', 'conflicts', 'editor', 'dataGovernance'].map(workspace => navNode({ parentTab: 'processGovernance', workspace })),
    navNode({ tab: 'dataMap' })];
  const navigation = vm.createContext({
    $: () => group, document: { querySelectorAll: () => links },
    processGovernanceViewFromRoute: route => route.pgWorkspace || 'editor',
    processGovernanceSubtabHash: workspace => workspace === 'editor' ? '#/processGovernance' : '#/processGovernance?workspace=' + workspace,
    parseHash: () => ({ tab: 'processGovernance', pgWorkspace: 'editor' }),
    location: { hash: '#/processGovernance' }, state: { processDesign: { canonicalDirty: true } }, confirm: () => false
  });
  vm.runInContext(source('    function updateWorkspaceNavigation(', '    function parseHash()'), navigation);
  for (const workspace of ['v7Preview', 'handoffs', 'conflicts', 'editor', 'dataGovernance']) {
    navigation.updateWorkspaceNavigation({ tab: 'processGovernance', pgWorkspace: workspace });
    const selected = links.filter(link => link.attributes['aria-current'] === 'page');
    assert.equal(selected.length, 1);
    assert.equal(selected[0].dataset.workspace, workspace);
    assert.equal(links[0].classes.has('on'), false);
  }
  assert.equal(group.open, true);
  navigation.updateWorkspaceNavigation({ tab: 'dataMap' });
  assert.equal(links.filter(link => link.classes.has('on')).length, 1);
  assert.equal(links.at(-1).attributes['aria-current'], 'page');
  assert.equal(navigation.navigateWorkspaceButton(links[1]), false);
  assert.equal(navigation.location.hash, '#/processGovernance', 'cancel preserves current route and unsaved input');
  navigation.confirm = () => true;
  assert.equal(navigation.navigateWorkspaceButton(links[1]), true);
  assert.equal(navigation.location.hash, '#/processGovernance?workspace=v7Preview');
  console.log('Frontend UX behavior tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
