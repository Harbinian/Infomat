const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
function between(start, end) {
  const from = html.indexOf(start);
  assert.ok(from >= 0, start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(to > from, end);
  return html.slice(from, to);
}

// Execute the real event branches with a minimal DOM boundary. These checks
// complement browser verification; they do not simulate native focus behavior.
const operationBranch = between("      if (target.matches('[data-graph-data-operation]')", "      if (target.matches('[data-bind=\"process.owning_department\"]')");
for (const operation of ['update', 'create', 'use', 'pending_confirmation']) {
  const calls = [];
  const context = {
    target: { matches: () => true, value: operation }, graphSelection: { kind: 'data-edge' },
    workspace: {
      querySelectorAll: () => [{ value: operation }],
      querySelector: () => ({ focus: () => calls.push('focus') })
    },
    CSS: { escape: value => value },
    editSessionManager: { updatePatch: patch => calls.push(patch) },
    updateDataEdgeCanApply: () => calls.push('canApply'),
    refreshUnappliedIndicators: () => calls.push('indicators'),
    render: () => calls.push('render')
  };
  vm.runInNewContext(`(function () { ${operationBranch} })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].operations)), [operation]);
  assert.equal(calls.includes('render'), true, 'operation-dependent controls must refresh');
  assert.equal(calls.at(-1), 'focus', 'restore the selected operation after rendering');
  assert.equal('updatedFieldRefs' in calls[0], operation !== 'update');
}

const fieldBranch = between('      if (/^data_objects\\.\\d+\\.fields\\.\\d+\\.(field_name|field_type)$/.test', "      if (target.matches('[data-bind]') && (");
for (const field of ['field_name', 'field_type']) {
  const selector = {};
  vm.runInNewContext(`(function () { ${fieldBranch} })()`, {
    target: { dataset: { bind: `data_objects.0.fields.0.${field}` } },
    currentDocument: () => ({ data_objects: [{ fields: [{ field_ref: 'f1', field_name: '<校对>' }] }] }),
    workspace: { querySelector: () => selector }, CSS: { escape: value => value },
    render: () => assert.fail('field change must not detach native focus targets')
  });
  assert.equal(selector.textContent, '1. <校对>');
  assert.equal(selector.title, '<校对>');
}

{
  const context = {
    currentExecutionDepartment: () => '工程技术部',
    currentDocument: () => ({ behaviors: ['action', 'decision', 'parallel_split', 'parallel_join'].map(node_type => ({ node_type, behavior_ref: node_type, behavior_name: node_type })) }),
    actorAssignmentMode: () => 'fixed_department', parseActorRole: () => ({ department: '' })
  };
  vm.createContext(context);
  const start = html.indexOf('    function behaviorOptions(');
  const end = html.indexOf('\n    function ', start + 10);
  vm.runInContext(html.slice(start, end), context);
  const options = context.behaviorOptions();
  assert.match(options[0].label, /执行部门待选择/);
  for (const option of options.slice(1)) {
    assert.match(option.label, /流程控制/);
    assert.doesNotMatch(option.label, /执行部门待选择|跨部门/);
  }
}

async function checkGraphSelection() {
  const documentValue = { data_objects: [{ data_ref: 'old' }] };
  const nextDocument = { data_objects: [...documentValue.data_objects, { data_ref: 'new' }] };
  const entry = { data: documentValue };
  let selected = 'old';
  const context = {
    currentEntry: () => entry, captureGraphViewport() {}, candidateStateKey: () => 'candidate',
    GraphEditCommands: { applyCommand: () => ({ ok: true, document: nextDocument, details: { selected: { kind: 'data', ref: 'new' } } }) },
    graphStateManager: { execute: (key, data, command) => command() },
    updateSelectionFromGraphResult: result => { selected = result.details.selected.ref; },
    invalidateCurrentChecks() {}, refreshCandidateDirty() {}, showStatus() {}, refreshValidationAfterGraphCommand() {},
    resetWebGridEditor: () => { selected = 'old'; },
    render: () => assert.equal(selected, 'new', 'old grid context must not overwrite new graph selection')
  };
  vm.createContext(context);
  vm.runInContext(between('    async function runGraphCommand(', '    function newGraphBehavior()'), context);
  assert.equal(await context.runGraphCommand({ type: 'add_data_object' }), true);
}
checkGraphSelection().then(() => console.log('guided interaction regression tests passed')).catch(error => { console.error(error); process.exitCode = 1; });
