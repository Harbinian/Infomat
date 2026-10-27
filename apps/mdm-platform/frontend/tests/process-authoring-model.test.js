import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { acceptReceipt, authoringContentDirty, authoringDirty, authoringMaterialsDirty, createAuthoringClient, createAuthoringViewGuard, createEditorFetch, definiteRejection, editorEndpoint, fingerprint, prepareAttempt } from '../src/processAuthoringModel.js';
import { scopedEditorCss } from '../src/processAuthoringBridge.js';
import { createWorkbenchController } from '../../../structured-output-service/frontend/controller.mjs';
import { DOMAIN_MODULE_FILES } from '../../../structured-output-service/frontend/bridge.mjs';
import { organizationField, organizationInputErrors } from '../../../structured-output-service/frontend/organization.mjs';

const require = createRequire(import.meta.url);
const modules = Object.fromEntries(DOMAIN_MODULE_FILES.map(({ name, file }) => [name, require(`../../../structured-output-service/public/${file}`)]));
const sourceDocument = () => ({ schema_version: 'process-governance-v9', process: { process_ref: 'process_fixture', process_name: '隔离测试流程', owning_department: '测试部门', purpose: '原目的' }, behaviors: [], flow_relations: [], data_objects: [], forms: [], terms: [], export_meta: { exported_at: '' } });
function workspace(document = sourceDocument()) {
  const state = { document, pending: false, busy: false };
  const submission = { purpose: '本次目的', sources: [], participants: [] };
  return { controller: { getSnapshot: () => state }, state, submission, savedDocument: null, savedSubmission: fingerprint(submission), record: null, attempt: null };
}

test('late bootstrap cannot publish or navigate after leaving, changing identity, selecting another target or unmounting', async () => {
  for (const change of ['leave', 'identity', 'target', 'unmount']) {
    let owner = 'person:department', view = '/app/process-authoring?draft=one', resume;
    const gate = createAuthoringViewGuard({ getOwner: () => owner, getView: () => view }), stamp = gate.begin();
    const effects = [];
    const delayed = (async () => { await new Promise(resolve => { resume = resolve; }); if(gate.current(stamp)) effects.push('publish', 'replace-location', 'destroy-old-controller'); })();
    if(change === 'leave')view = '/app/process-preview';
    if(change === 'identity')owner = 'other:department';
    if(change === 'target'){view = '/app/process-authoring?draft=two';gate.begin();}
    if(change === 'unmount')gate.invalidate();
    resume(); await delayed;
    assert.deepEqual(effects, [], change);
  }
});

test('a current operation may update its own draft URL but cannot survive a later view operation', () => {
  let view = '/app/process-authoring';
  const gate = createAuthoringViewGuard({ getOwner: () => 'original-owner', getView: () => view });
  const stamp = gate.begin(); assert.equal(gate.current(stamp), true);
  view = '/app/process-authoring?draft=created'; stamp.view = view;
  assert.equal(gate.current(stamp), true);
  gate.begin(); assert.equal(gate.current(stamp), false);
});

test('same-component URL changes release only their own busy and lock while preserving newer operation ownership', () => {
  let view = '/app/process-authoring?draft=one';
  const gate = createAuthoringViewGuard({ getOwner: () => 'owner', getView: () => view });
  const old = gate.begin({ lock: true });
  view = '/app/process-authoring?draft=two';
  assert.equal(gate.current(old), false); assert.equal(gate.locked, true);
  assert.equal(gate.finish(old), true); assert.equal(gate.locked, false);
  const first = gate.begin({ lock: true }), next = gate.begin({ lock: true });
  assert.equal(gate.finish(first), false); assert.equal(gate.locked, true); assert.equal(gate.current(next), true);
  assert.equal(gate.finish(next), true); assert.equal(gate.locked, false);
  assert.equal(gate.finish(first), false);
});

test('editor calls are confined to the separated 3000 API and use the shared authenticated client', async () => {
  const calls = [], fetcher = createEditorFetch({ request: async (...args) => { calls.push(args); return { valid: true }; } });
  const signal = new AbortController().signal;
  const response = await fetcher('/api/validate', { method: 'POST', body: JSON.stringify({ data: sourceDocument() }), signal });
  assert.equal((await response.json()).valid, true);
  assert.equal(calls[0][0], '/api/process-authoring/editor/validate');
  assert.equal(calls[0][1].signal, signal);
  assert.equal(calls[0][1].body.data.process.process_ref, 'process_fixture');
  for (const url of ['http://localhost:3001/api/validate', '/api/org/users', '//outside.invalid/api/validate', '/api/template?callback=x', '/api/serialize']) assert.throws(() => editorEndpoint(url));
});

test('create, save and submit preserve explicit revision/hash binding and never inherit approval fields', () => {
  const value = workspace();
  const created = prepareAttempt(value, 'save', 'request-create');
  assert.equal(created.method, 'POST'); assert.equal(created.url, '/api/process-authoring/drafts');
  assert.deepEqual(Object.keys(created.body).sort(), ['document', 'request_id', 'submission']);
  assert.throws(() => prepareAttempt(value, 'submit', 'request-submit'), /先保存/);
  value.record = { id: 'draft-id', revision_no: 4, content_hash: 'hash-4' };
  const saved = prepareAttempt(value, 'save', 'request-save');
  assert.equal(saved.method, 'PUT'); assert.equal(saved.body.expected_revision_no, 4); assert.equal(saved.body.expected_content_hash, 'hash-4');
  value.savedDocument = fingerprint(value.state.document);
  const submitted = prepareAttempt(value, 'submit', 'request-submit');
  assert.equal(submitted.url, '/api/process-authoring/drafts/draft-id/submit');
  assert.equal(submitted.body.document, undefined); assert.equal(submitted.body.expected_content_hash, 'hash-4');
  value.state.pending = true;
  assert.throws(() => prepareAttempt(value, 'save'), /未应用输入/);
});

test('a late save receipt retains newer document, material and panel input', () => {
  const value = workspace(), attempt = prepareAttempt(value, 'save', 'stable-request');
  value.attempt = attempt;
  value.state.document.process.purpose = '请求期间的新正文';
  value.state.pending = true; value.submission.purpose = '请求期间的新材料';
  const receipt = { draft: { id: 'draft-id', revision_no: 1, content_hash: 'saved-hash', document: attempt.document }, allowed_actions: ['view', 'save'] };
  acceptReceipt(value, attempt, receipt);
  assert.equal(value.state.document.process.purpose, '请求期间的新正文');
  assert.equal(value.submission.purpose, '请求期间的新材料'); assert.equal(value.state.pending, true);
  assert.equal(value.record.content_hash, 'saved-hash'); assert.equal(value.savedDocument, fingerprint(attempt.document));
  assert.equal(authoringDirty(value), true);
  value.state.pending = false;
  assert.equal(authoringDirty(value), true);
});

test('an authorized submitter can provide materials for the saved body without acquiring compilation rights', () => {
  const value = workspace();
  value.record = { id: 'draft-id', revision_no: 3, content_hash: 'body-hash' };
  value.allowedActions = ['view', 'submit']; value.savedDocument = fingerprint(value.state.document);
  value.submission.purpose = '主对接人本次明确提供的材料';
  assert.equal(authoringContentDirty(value), false); assert.equal(authoringMaterialsDirty(value), true); assert.equal(authoringDirty(value), true);
  const attempt = prepareAttempt(value, 'submit', 'submit-materials');
  assert.equal(attempt.body.submission.purpose, value.submission.purpose); assert.equal(attempt.body.document, undefined);
  assert.equal(attempt.body.expected_revision_no, 3); assert.equal(attempt.body.expected_content_hash, 'body-hash');
  value.state.document.process.purpose = '试图修改正文';
  assert.throws(() => prepareAttempt(value, 'submit', 'submit-modified-body'), /先保存当前草稿正文/);
});

test('submission acknowledgment records the submitted material baseline and retains later material input', () => {
  const value = workspace();
  value.record = { id: 'draft-id', revision_no: 3, content_hash: 'body-hash' }; value.savedDocument = fingerprint(value.state.document);
  value.submission.purpose = '实际提交的材料';
  const attempt = prepareAttempt(value, 'submit', 'submit-materials'); value.attempt = attempt;
  value.submission.purpose = '回执之前的新材料';
  acceptReceipt(value, attempt, { draft: { id: 'draft-id', revision_no: 4, content_hash: 'body-hash', document: attempt.document, submission: attempt.submission }, allowed_actions: ['view', 'submit'] });
  assert.equal(value.savedSubmission, fingerprint(attempt.submission));
  assert.equal(value.submission.purpose, '回执之前的新材料'); assert.equal(authoringMaterialsDirty(value), true); assert.equal(authoringContentDirty(value), false);
});

test('downloaded status cannot clear the server-save baseline and uncertain writes retain their exact request', async () => {
  const value = workspace();
  value.state.dirty = false; value.state.download = { fileName: 'draft.json' };
  assert.equal(authoringDirty(value), true);
  const attempt = prepareAttempt(value, 'save', 'same-request'); value.attempt = attempt;
  assert.throws(() => prepareAttempt(value, 'save'), /原请求/);
  const calls = [], client = createAuthoringClient({ request: async (url, options) => { calls.push({ url, ...options }); throw Object.assign(new Error('timeout'), { status: 0 }); } });
  await assert.rejects(client.execute(attempt)); await assert.rejects(client.execute(attempt));
  assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].body.request_id, 'same-request');
  assert.equal(definiteRejection({ status: 409 }), true); assert.equal(definiteRejection({ status: 503 }), false);
});

test('a mismatched or incomplete receipt cannot acknowledge another document or clear the original request', () => {
  const value = workspace(), attempt = prepareAttempt(value, 'save', 'same-request'); value.attempt = attempt;
  const changed = sourceDocument(); changed.process.purpose = '其他内容';
  for (const draft of [null, { id: 'id', revision_no: 1, content_hash: 'hash', document: changed }, { id: 'id', revision_no: 1, document: attempt.document }]) {
    assert.throws(() => acceptReceipt(value, attempt, { draft }), /回执/);
    assert.equal(value.attempt, attempt); assert.equal(value.record, null);
  }
});

test('business exported_at keys in archived JSON and materials remain part of dirty and exact receipt checks', () => {
  const value = workspace();
  value.state.document.migration = { archived_source: { exported_at: '2026-01-01', description: '历史原文' } };
  value.record = { id: 'draft-id', revision_no: 2, content_hash: 'hash' }; value.savedDocument = fingerprint(value.state.document);
  value.state.document.migration.archived_source.exported_at = '2026-02-01';
  assert.equal(authoringContentDirty(value), true);
  const attempt = prepareAttempt(value, 'save', 'archive-change'); value.attempt = attempt;
  const altered = structuredClone(attempt.document); altered.migration.archived_source.exported_at = '2026-03-01';
  assert.throws(() => acceptReceipt(value, attempt, { draft: { id: 'draft-id', revision_no: 3, content_hash: 'hash', document: altered } }), /回执/);
  assert.equal(value.attempt, attempt);
  value.submission.exported_at = '材料中明确记载的时间';
  assert.equal(authoringMaterialsDirty(value), true);
  assert.notEqual(fingerprint({ export_meta: { exported_at: 'old' } }), fingerprint({ export_meta: { exported_at: 'new' } }));
});

test('case continuation binds the user-selected case revision and hash without substituting current values', async () => {
  const calls = [], client = createAuthoringClient({ request: async (url, options) => calls.push({ url, ...options }) });
  await client.fromCase('9007199254740993', 'stable-request', { revision_no: 7, content_hash: 'selected-hash' });
  assert.equal(calls[0].url, '/api/process-authoring/drafts/from-case/9007199254740993');
  assert.deepEqual(calls[0].body, { request_id: 'stable-request', expected_revision_no: 7, expected_content_hash: 'selected-hash' });
});

test('controller saved acknowledgment preserves pending inputs and rejects stale document receipts', async () => {
  const controller = createWorkbenchController({ modules, template: sourceDocument(), enums: {}, schema: {}, initialDirty: true, validate: async () => ({ valid: true, errors: [] }) });
  await controller.dispatch({ type: 'init' });
  await controller.dispatch({ type: 'select', target: { kind: 'process', ref: 'process_fixture' } });
  await controller.dispatch({ type: 'edit' });
  const original = structuredClone(controller.getSnapshot().document);
  await controller.dispatch({ type: 'update', field: 'purpose', value: '尚未应用的目的' });
  assert.equal(controller.getSnapshot().pending, true);
  assert.equal(controller.acknowledgeSaved(original), true);
  assert.equal(controller.getSnapshot().pending, true);
  assert.equal(controller.getSnapshot().session.values.purpose, '尚未应用的目的');
  assert.equal((await controller.dispatch({ type: 'apply' })).ok, true);
  assert.equal(controller.acknowledgeSaved(original), false);
  assert.equal(controller.getSnapshot().dirty, true);
  controller.destroy();
});

test('department-only mode permits explicitly entered positions while preserving the default catalog restriction', () => {
  const enums = { rosterRolesByDepartment: { 测试部门: [] }, organizationCatalogMode: 'departments_only' };
  const before = sourceDocument(), after = structuredClone(before);
  after.behaviors = [{ behavior_ref: 'b1', actor_assignment_mode: 'fixed_department', current_actor_role: '测试部门 / 现场检验员' }];
  assert.deepEqual(organizationInputErrors(before, after, enums), []);
  assert.ok(organizationInputErrors(before, after, { ...enums, organizationCatalogMode: undefined }).length);
  assert.equal(organizationField({ key: 'current_actor_role' }, enums).manualPositions, true);
  assert.equal(organizationField({ key: 'responsibility.position' }, enums).editor, 'text');
  after.behaviors[0].current_actor_role = '非有效部门 / 岗位';
  assert.ok(organizationInputErrors(before, after, enums).length);
});

test('host import scope rejection happens before any document replacement and preserves the original editor', async () => {
  const original = sourceDocument(), incoming = sourceDocument(); incoming.process.process_ref = 'another_process';
  const controller = createWorkbenchController({ modules, template: original, enums: {}, schema: {}, initialDirty: false,
    validate: async () => ({ valid: true, errors: [] }), assertImportDocument: document => { if(document.process.process_ref !== original.process.process_ref) throw new Error('另一个流程'); } });
  await controller.dispatch({ type: 'init' });
  const before = controller.getSnapshot();
  const result = await controller.dispatch({ type: 'import', text: JSON.stringify(incoming), fileName: 'another.json', confirmedDiscard: true });
  assert.equal(result.ok, false); assert.equal(fingerprint(controller.getSnapshot().document), fingerprint(before.document));
  assert.equal(controller.getSnapshot().candidateKey, before.candidateKey); controller.destroy();
});

test('the complete shared editor stylesheet remains contained and does not reset host document sizing', async () => {
  const css = await readFile(new URL('../../../structured-output-service/frontend/workbench.css', import.meta.url), 'utf8');
  const scoped = scopedEditorCss(css);
  assert.ok(!scoped.includes('height:100vh')); assert.ok(!scoped.includes('#root')); assert.ok(!scoped.includes(':root'));
  for (const match of scoped.matchAll(/([^{}]+)\{/g)) for (const selector of match[1].split(',')) assert.ok(selector.trim().startsWith('.process-authoring-editor'));
  assert.throws(() => scopedEditorCss('@media print{body{color:red}}'));
});
