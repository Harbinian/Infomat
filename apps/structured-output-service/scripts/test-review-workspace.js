const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const Review = require('../public/review-workspace');
const EditSession = require('../public/edit-session-manager');
const { createReviewLayoutFixture } = require('./review-layout-fixture');
const { processGovernanceValidationResult } = require('../server');

const source = createReviewLayoutFixture();
assert.equal(processGovernanceValidationResult(source).valid, true, 'Browser fixture must satisfy the real v7 contract');
const original = JSON.stringify(source);
const manager = Review.createManager();
const behavior = { kind: 'behavior', ref: 'behavior_review' };
const form = { kind: 'form', ref: 'form_application' };
const field = { kind: 'data-field', parentRef: 'data_fixture_application', ref: 'field_amount' };
manager.open('a', behavior, true);
manager.get('a').scroll[Review.targetKey(behavior)] = 315;
manager.open('a', form);
manager.open('a', field);
assert.equal(manager.get('a').trail.length, 3);
assert.equal(manager.get('b').trail.length, 0, 'Candidates must not inherit another candidate context');
manager.back('a', 0);
assert.equal(manager.get('a').scroll[Review.targetKey(behavior)], 315);
manager.open('a', form);
manager.open('a', behavior);
assert.equal(manager.get('a').trail.length, 1, 'A link to an ancestor must not create a cyclic trail');
assert.equal(Review.resolve(source, { ...field, parentRef: 'data_unlinked' }), null);
assert.equal(Review.resolve(source, { kind: 'form-item', ref: 'item_amount', parentRef: 'form_unlinked' }), null);
assert.equal(Review.linkedObjects(source, 'behavior_review').forms.length, 1);
assert.equal(JSON.stringify(source), original, 'Reading and navigation must not add or change business facts');

const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script);
const baseline = execFileSync('git', ['show', 'HEAD:apps/structured-output-service/public/index.html'], { encoding: 'utf8' });
assert.equal(html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\r/g, ''), baseline.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\r/g, ''), 'Existing visual system must remain byte-for-byte unchanged');
const css = fs.readFileSync(require.resolve('../public/review-workspace.css'), 'utf8');
assert.doesNotMatch(css, /(?:^|[;{])\s*(?:color|background(?:-[\w-]+)?|font(?:-[\w-]+)?|border(?:-[\w-]+)?|box-shadow)\s*:/m, 'Candidate CSS must only change layout');

// Old facts must remain readable when the former action page is folded into the diagram.
const summaryDocument = structuredClone(source);
const summaryBehavior = summaryDocument.behaviors[1];
Object.assign(summaryBehavior, { trigger: 'Historical trigger value', input_description: 'Historical input value', output_description: 'Historical output value', timing: 'Historical timing value' });
const summaryHost = {
  currentDocument: () => summaryDocument, ReviewWorkspace: Review,
  reviewSection: (_title, body) => body, reviewFacts: entries => entries.map(entry => entry.join(':')).join('|'),
  reviewLink: (_kind, _ref, label) => label, escapeHtml: String, text: value => String(value || ''),
  actorAssignmentMode: () => 'fixed_department', renderLegacyCrossDepartmentGuidance: () => 'Legacy department guidance',
  NODE_TYPES: [], DATA_OPERATIONS: [{ value: 'use', label: 'Uses data' }], FORM_OPERATIONS: [{ value: 'review', label: 'Reviews form' }]
};
vm.createContext(summaryHost);
for (const name of ['renderLegacyBehaviorSupplement', 'renderReviewSummary']) {
  const offset = html.indexOf(`    function ${name}(`);
  vm.runInContext(html.slice(offset, html.indexOf('\n    function ', offset + 1)), summaryHost);
}
const actionSummary = summaryHost.renderReviewSummary(behavior, summaryBehavior);
for (const value of ['Historical trigger value', 'Historical input value', 'Historical output value', 'Uses data', 'Reviews form', 'Legacy department guidance']) {
  assert.ok(actionSummary.includes(value), `Existing action information must be reachable: ${value}`);
}
summaryBehavior.node_type = 'decision';
const controlSummary = summaryHost.renderReviewSummary(behavior, summaryBehavior);
for (const value of [summaryBehavior.current_actor_role, summaryBehavior.behavior_description, summaryBehavior.completion_standard, summaryBehavior.timing]) {
  assert.ok(controlSummary.includes(value), 'Changing to a control node must retain former ordinary behavior facts');
}

// Exercise the actual host adapter against concurrent edits, shared references and candidate changes.
const start = html.indexOf('    function applyReviewProperties()');
const end = html.indexOf('\n    function ', start + 1);
const hostSource = html.slice(start, end);
function hostFixture() {
  const document = structuredClone(source);
  const editSessionManager = EditSession.createManager();
  let committed = 0;
  const ctx = { editingGroup: 'data-field' };
  const sandbox = {
    ReviewWorkspace: Review, editSessionManager,
    reviewTarget: () => field, candidateStateKey: () => 'a',
    currentDocument: () => document, reviewContext: () => ctx,
    clone: structuredClone, showStatus() {}, render() {}, graphPropertyConflictMessage: () => 'conflict',
    runDocumentTransaction(mutator, options) { mutator(document); committed += 1; options.afterCommit(); return { ok: true, changed: true }; }
  };
  vm.createContext(sandbox);
  vm.runInContext(hostSource, sandbox);
  editSessionManager.open({ candidateKey: 'a', editorKind: 'review-properties', entityRef: Review.targetKey(field), allowedFields: Review.EDIT_FIELDS['data-field'], baselineFields: Review.resolve(document, field), patch: {}, canApply: true });
  return { document, sandbox, editSessionManager, committed: () => committed };
}
const normal = hostFixture();
normal.editSessionManager.updatePatch({ field_type: '文本' });
normal.document.data_objects[0].description = 'Concurrent unrelated object change';
assert.equal(normal.sandbox.applyReviewProperties(), true);
assert.equal(normal.document.forms[0].areas[0].items[0].item_type, '文本');
assert.equal(normal.document.forms[0].areas[0].items[0].data_field_ref, 'field_amount');
assert.equal(normal.document.data_objects[0].description, 'Concurrent unrelated object change');
assert.equal(normal.committed(), 1);
const conflict = hostFixture();
conflict.editSessionManager.updatePatch({ field_name: '新名称' });
conflict.document.data_objects[0].fields[0].field_name = 'Other source changed';
assert.equal(conflict.sandbox.applyReviewProperties(), false);
assert.equal(conflict.committed(), 0);
assert.equal(conflict.editSessionManager.isDirty('a'), true);
const otherCandidate = hostFixture();
otherCandidate.editSessionManager.updatePatch({ definition: 'Only for candidate a' });
otherCandidate.sandbox.candidateStateKey = () => 'b';
assert.equal(otherCandidate.sandbox.applyReviewProperties(), false);
assert.equal(otherCandidate.committed(), 0);

// Exercise the real navigation adapter: a catalog click starts a path, a detail link extends it.
const navigationManager = Review.createManager();
const entry = { governanceStep: 'skeleton', stepView: 'list' };
const navigation = {
  ReviewWorkspace: Review,
  GovernanceWorkflow: { normalizeStepId: value => value },
  reviewWorkspaceManager: navigationManager,
  reviewContext: () => navigationManager.get('a'),
  reviewTarget: () => navigationManager.get('a').trail.at(-1) || null,
  candidateStateKey: () => 'a', currentDocument: () => source, currentEntry: () => entry,
  captureReviewPosition() {}, captureGraphViewport() {}, render() {}, requestAnimationFrame() {}, showStatus() {},
  editSessionManager: { reset() {} }, requestTransition: () => false,
  compactTaskUiEnabled: () => true, defaultStepView: () => 'diagram',
  graphStateManager: { updateView() {} },
  activeGovernanceStep: 'skeleton', activeStepView: 'list', activeDataEditingMode: 'guided', activeDataMode: 'flow'
};
vm.createContext(navigation);
for (const name of ['openReviewTarget', 'handleReviewAction', 'setActiveGovernanceStep']) {
  const functionStart = html.indexOf(`    function ${name}(`);
  const functionEnd = html.indexOf('\n    function ', functionStart + 1);
  vm.runInContext(html.slice(functionStart, functionEnd), navigation);
}
navigationManager.get('a').flowView = 'list';
navigation.openReviewTarget(behavior, true);
assert.equal(navigation.activeStepView, 'list', 'Selecting a list item must keep the fallback list usable');
navigation.activeGovernanceStep = 'data';
navigation.activeStepView = 'catalog';
const clickReviewLink = (target, inDetail) => navigation.handleReviewAction('review-open', {
  dataset: { ...target, parentRef: target.parentRef || '' }, closest: () => inDetail ? {} : null
});
clickReviewLink(form, false);
assert.equal(navigation.activeGovernanceStep, 'data', 'Catalog objects must not switch to the flow task');
assert.equal(entry.stepView, 'detail');
clickReviewLink({ kind: 'form-item', parentRef: 'form_application', ref: 'item_amount' }, true);
clickReviewLink(field, true);
assert.equal(navigationManager.get('a').trail.length, 3, 'Detail links must preserve the catalog breadcrumb');
navigation.handleReviewAction('review-back', { hasAttribute: () => false });
assert.equal(navigationManager.get('a').trail.at(-1).kind, 'form-item');
assert.equal(entry.governanceStep, 'data');
navigation.setActiveGovernanceStep('skeleton');
assert.equal(navigationManager.get('a').trail.at(-1).ref, behavior.ref, 'Returning to the flow must restore its earlier target');
assert.equal(JSON.stringify(source), original, 'All navigation must leave document facts unchanged');
// The guide uses the production navigation adapter, not a second document workflow.
navigation.workspace = { scrollTop: 0 };
for (const name of ['openAuthoringGuideStep', 'renderAuthoringGuide']) {
  const offset = html.indexOf(`    function ${name}(`);
  vm.runInContext(html.slice(offset, html.indexOf('\n    function ', offset + 1)), navigation);
}
Object.assign(navigation, { escapeAttribute: String, escapeHtml: String, busy: false,
  pendingTransitionResolution: false, webGridApplyInFlight: false, formFieldBatchApplying: false });
for (let index = 0; index < Review.GUIDE_STEPS.length; index += 1) {
  navigation.openAuthoringGuideStep({ dataset: { guideIndex: String(index), guideCandidate: 'a' } });
  assert.equal(navigation.activeGovernanceStep, Review.GUIDE_STEPS[index].step);
  assert.equal(navigation.activeStepView, Review.GUIDE_STEPS[index].view);
  assert.equal(navigationManager.get('a').guideStep, index);
  assert.equal(navigationManager.get('b').guideStep, undefined);
}
assert.match(navigation.renderAuthoringGuide(source), /data-action="export-current"/, 'Final guide action must use the existing checked download');
navigation.activeGovernanceStep = 'skeleton';
assert.match(navigation.renderAuthoringGuide(source), /下一步：返回检查并下载/, 'Free navigation must offer a clear return to the paused guide');
for (const [guideIndex, guideCandidate] of [['99', 'a'], ['NaN', 'a'], ['1', 'b']]) {
  navigation.openAuthoringGuideStep({ dataset: { guideIndex, guideCandidate } });
  assert.equal(navigationManager.get('a').guideStep, 7, 'Invalid or stale candidate actions must not advance');
}
assert.equal(JSON.stringify(source), original, 'Guide navigation must never change facts, references or file status');
assert.equal(navigation.renderAuthoringGuide(null), '', 'No guide navigation before opening a file');
navigation.compactTaskUiEnabled = () => false;
assert.equal(navigation.renderAuthoringGuide(source), '', 'Classic fallback must stay unchanged');
console.log('Review workspace: guide navigation, candidate isolation, shared definition edits, conflicts and unchanged visual system passed');
