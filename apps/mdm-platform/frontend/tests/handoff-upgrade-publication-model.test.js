import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpgradeDecisions, governancePointers, restorationCandidate, restorationRequestBody, upgradeAssessmentBody, withdrawalState } from '../src/handoffUpgradePublicationModel.js';

const proof = { basis: '当前核对依据', evidence_refs: 'source:one\nsource:two' };
const binding = (id, refs) => ({ binding_id: id, snapshot_json: { detail_versions: refs.map(ref => ({ detail_ref: ref, detail_version_id: `${id}-${ref}`, governance: { scope: ref, nested: { 'a/b~c': 0 } } })) } });
const comparison = { source_package_id: '100', comparison_digest: 'fixed-comparison', changes: ['added', 'modified', 'deleted', 'unchanged'].map(kind => ({ detail_ref: kind, change_kind: kind })) };
function upgrade() {
  const source = binding('old', ['modified', 'deleted', 'unchanged']), target = binding('new', ['added', 'modified', 'unchanged']);
  const decisions = createUpgradeDecisions(comparison, source, target).map(item => ({ ...item, decision: item.change_kind === 'unchanged' ? 'reference_and_recheck' : item.decision, reuse_scope: item.change_kind === 'unchanged' ? ['/scope'] : [], ...proof, rechecks: Object.fromEntries(['facts', 'conclusions', 'shared_definitions', 'impact'].map(key => [key, proof])) }));
  return { expectedRevision: 7, sourcePackageId: '100', sourceBindingId: 'old', sourceBindingsExist: true, comparison, decisions, ...proof };
}
test('Q9 keeps four change classes and exact old/new detail versions without selecting unchanged reuse', () => {
  const decisions = createUpgradeDecisions(comparison, binding('old', ['deleted', 'modified', 'unchanged']), binding('new', ['added', 'modified', 'unchanged']));
  assert.equal(decisions.find(x => x.change_kind === 'unchanged').decision, '');
  assert.equal(decisions[0].source_detail_version_id, null); assert.equal(decisions[2].target_detail_version_id, null);
  assert.deepEqual(decisions.map(x => x.change_kind), ['added', 'modified', 'deleted', 'unchanged']);
});
test('Q9 serializes exact review evidence, explicit pointers and all four new rechecks', () => {
  const body = upgradeAssessmentBody(upgrade());
  assert.equal(body.expected_revision, 7); assert.equal(body.source_binding_id, 'old'); assert.equal(body.decisions[3].source_detail_version_id, 'old-unchanged');
  assert.deepEqual(body.decisions[3].reuse_scope, ['/scope']); assert.deepEqual(body.decisions[0].rechecks.facts.evidence_refs, ['source:one', 'source:two']);
  assert.deepEqual(Object.keys(body.decisions[0].rechecks), ['facts', 'conclusions', 'shared_definitions', 'impact']);
});
test('Q9 incomplete rechecks and a changed original package are rejected without mutating input', () => {
  const input = upgrade(), before = structuredClone(input); input.decisions[0].rechecks.impact = { basis: '', evidence_refs: '' };
  assert.throws(() => upgradeAssessmentBody(input), /影响重核/u); assert.equal(input.decisions[3].decision, before.decisions[3].decision);
  input.sourcePackageId = '101'; assert.throws(() => upgradeAssessmentBody(input), /固定版本比较/u);
});
test('Q9 absent historical review remains absent and explicit no-reuse has an empty scope', () => {
  const input = upgrade(); input.sourceBindingId = ''; input.sourceBindingsExist = false;
  input.decisions = input.decisions.map(x => ({ ...x, source_detail_version_id: null, decision: x.change_kind === 'deleted' ? 'remove' : 'recheck', reuse_scope: [] }));
  const body = upgradeAssessmentBody(input); assert.equal(body.source_binding_id, null); assert(body.decisions.every(x => !x.source_detail_version_id && !x.reuse_scope.length));
});
test('governance pointer choices preserve falsey and escaped exact values and reject special prototype names', () => {
  const values = governancePointers({ nested: { 'a/b~c': 0, flag: false, empty: '' }, constructor: 'excluded' });
  assert.deepEqual(values.find(x => x.pointer === '/nested/a~1b~0c'), { pointer: '/nested/a~1b~0c', value: 0 });
  assert.equal(values.find(x => x.pointer === '/nested/flag').value, false); assert(!values.some(x => x.pointer === '/constructor'));
});

const publication = { publication_id: 'original', manifest: { handoff_revision_id: 'exact', items: [{ item_ref: 'object', target_kind: 'object', target_id: '9007199254740993', target_version_ref: '9007199254740995', produces_version: 1 }, { item_ref: 'field', target_kind: 'field', target_id: '42', target_version_ref: 'fixed-reused', produces_version: 0 }] } };
const trace = { revisions: [{ revision_id: 'exact', snapshot_json: { schema_version: 'handoff-draft-v1', scope_mode: 'historical', basis: 'original basis', items: [{ item_ref: 'object', target_kind: 'object', operation: 'create', definition: { name: 'Old definition' }, source_detail_refs: ['original-ref'], authority: [{ basis: 'original SOR evidence' }] }, { item_ref: 'field', target_kind: 'field', operation: 'reuse', target_id: '42', target_version_ref: 'fixed-reused', definition: {}, object_ref: 'object' }], dispositions: [], impact_dispositions: [], restores_publication_id: 'older-publication', restoration: { old: true }, restoration_adjustments: [] } }] };
test('Q10 candidate uses exact original revision and retains stable string ids and relationships without rewriting history', () => {
  const before = structuredClone(trace), body = restorationCandidate(publication, trace, 'current');
  assert.equal(body.items[0].operation, 'modify'); assert.equal(body.items[0].target_id, '9007199254740993'); assert.equal(body.items[0].base_version_ref, '9007199254740995');
  assert.equal(body.items[1].operation, 'reuse'); assert.equal(body.items[1].object_ref, 'object'); assert.deepEqual(body.items[0].source_detail_refs, ['original-ref']);
  assert(!body.restoration); assert(!body.restores_publication_id); assert(!body.restoration_adjustments); assert.deepEqual(trace, before);
  assert.throws(() => restorationCandidate(publication, { revisions: [] }, 'current'), /准确草案/u);
});
test('Q10 restoration requires explicit target review and every explicit adopt/adapt proof', () => {
  const values = { expectedRevision: 2, targetPackageId: '100', targetTrace: { package_id: '100', drafts: [] }, targetBindingId: 'new-review', targetMode: 'new', scopeMode: 'historical', restorationDraft: restorationCandidate(publication, trace, 'historical'), ...proof, itemMappings: publication.manifest.items.map(x => ({ source_item_ref: x.item_ref, target_item_ref: x.item_ref, content_decision: 'adopt', ...proof })) };
  const body = restorationRequestBody(values); assert.equal(body.expected_target_revision, 0); assert.equal(body.expected_target_binding_id, 'new-review'); assert(!body.target_handoff_id); assert.equal(body.item_mappings.length, 2);
  values.itemMappings[0].content_decision = ''; assert.throws(() => restorationRequestBody(values), /采用方式/u);
  values.itemMappings[0].content_decision = 'adapt'; values.targetBindingId = ''; assert.throws(() => restorationRequestBody(values), /目标准确审核/u);
});
test('Q10 append freezes the selected existing draft revision and cannot silently choose an active draft', () => {
  const values = { expectedRevision: 2, targetPackageId: '100', targetTrace: { package_id: '100', drafts: [{ handoff_id: 'selected', current_revision: 8, state: 'draft', active_slot: 1 }] }, targetBindingId: 'new-review', targetMode: 'append', targetHandoffId: '', scopeMode: 'current', restorationDraft: restorationCandidate(publication, trace, 'current'), ...proof, itemMappings: publication.manifest.items.map(x => ({ source_item_ref: x.item_ref, target_item_ref: x.item_ref, content_decision: 'adapt', ...proof })) };
  assert.throws(() => restorationRequestBody(values), /当前未提交草案/u); values.targetHandoffId = 'selected'; assert.throws(() => restorationRequestBody(values), /准确草案修订/u); values.expectedTargetRevision = 8;
  values.targetTrace.drafts[0].current_revision = 9; const body = restorationRequestBody(values); assert.equal(body.target_handoff_id, 'selected'); assert.equal(body.expected_target_revision, 8);
});

test('Q10 a new successful check and approval supersede cached earlier results without reusing an earlier reason or digest', () => {
  const reportA = { reason: 'Reason A', event_revision: 1, binding_digest: 'digest-A' };
  const approvalA = { publication_id: 'original', business_outcome: 'withdrawal_approved', withdrawal_approval_id: 'approval-A', binding_digest: 'digest-A' };
  const values = { expectedRevision: 1, reason: 'Reason A', withdrawalReport: reportA, withdrawalApproval: approvalA };
  assert.equal(withdrawalState('original', values, approvalA).approvalMatches, true);
  values.reason = 'Reason B'; assert.equal(withdrawalState('original', values, approvalA).approvalMatches, false);
  const reportB = { reason: 'Reason B', event_revision: 1, binding_digest: 'digest-B' };
  let state = withdrawalState('original', values, { publication_id: 'original', business_outcome: 'withdrawal_checked', report: reportB });
  assert.equal(state.report, reportB); assert.equal(state.checkMatches, true); assert.equal(state.approvalMatches, false);
  values.withdrawalReport = state.report;
  const approvalB = { ...approvalA, withdrawal_approval_id: 'approval-B', binding_digest: 'digest-B' };
  state = withdrawalState('original', values, approvalB);
  assert.equal(state.approval.withdrawal_approval_id, 'approval-B'); assert.equal(state.approvalMatches, true);
  assert.equal(values.withdrawalApproval.withdrawal_approval_id, 'approval-A'); assert.equal(reportA.reason, 'Reason A');
  state = withdrawalState('original', values, { ...approvalB, publication_id: 'another-publication' });
  assert.equal(state.approval.withdrawal_approval_id, 'approval-A'); assert.equal(state.approvalMatches, false);
});

test('Q10 a recheck after changed impact invalidates a cached approval even when the reason and event revision are unchanged', () => {
  const originalReport = { reason: 'Reason A', event_revision: 1, binding_digest: 'old-impact' }, changedReport = { ...originalReport, binding_digest: 'changed-impact' };
  const values = { expectedRevision: 1, reason: 'Reason A', withdrawalReport: originalReport, withdrawalApproval: { withdrawal_approval_id: 'old-approval', binding_digest: 'old-impact' } };
  let state = withdrawalState('original', values, { publication_id: 'original', business_outcome: 'withdrawal_checked', report: changedReport });
  assert.equal(state.report.binding_digest, 'changed-impact'); assert.equal(state.approvalMatches, false);
  values.withdrawalReport = state.report;
  state = withdrawalState('original', values, { publication_id: 'original', business_outcome: 'withdrawal_approved', withdrawal_approval_id: 'new-approval', binding_digest: 'changed-impact' });
  assert.equal(state.approval.withdrawal_approval_id, 'new-approval'); assert.equal(state.approvalMatches, true);
});
