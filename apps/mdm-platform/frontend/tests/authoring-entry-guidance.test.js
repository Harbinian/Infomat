import test from 'node:test';
import assert from 'node:assert/strict';
import { authoringEntryPresentation, fingerprint } from '../src/processAuthoringModel.js';

const feature = Object.freeze({ enabled: true, schema_ready: true });
const ready = list => ({ feature, list, listState: 'ready' });

test('an authorized empty list explains the real create, edit, save and reopen path', () => {
  const list = { items: [], allowed_actions: ['create_draft'] };
  const before = fingerprint(list);
  const view = authoringEntryPresentation(ready(list));
  assert.equal(view.kind, 'empty-create');
  assert.equal(view.canCreate, true);
  assert.equal(view.showSelector, false);
  assert.equal(view.canUpload, false);
  assert.match(view.description, /新建编制草稿/);
  assert.match(view.description, /编制器打开后才能/);
  assert.match(view.description, /保存草稿/);
  assert.match(view.description, /下次从本页列表重新打开/);
  assert.equal(fingerprint(list), before);
});

test('a read-only empty list does not turn absence of a create action into absence of every case compilation right', () => {
  const view = authoringEntryPresentation(ready({ items: [], allowed_actions: [] }));
  assert.equal(view.kind, 'empty-no-create');
  assert.equal(view.canCreate, false);
  assert.equal(view.canUpload, false);
  assert.match(view.description, /当前账号没有新建草稿入口/);
  assert.match(view.description, /空列表不表示所有流程都没有本人编制资格/);
  assert.match(view.description, /归口部门当前有效的主对接人/);
  assert.match(view.description, /原案例已明确的编制人员/);
  assert.match(view.description, /流程预览与核对/);
});

test('a successful legacy list without action metadata leaves new-draft eligibility unknown', () => {
  const view = authoringEntryPresentation(ready({ items: [] }));
  assert.equal(view.kind, 'empty-unknown');
  assert.equal(view.canCreate, false);
  assert.match(view.description, /尚未取得新建资格信息/);
  assert.doesNotMatch(view.description, /当前账号没有新建草稿入口/);
});

test('loading, failed and malformed reads do not reuse stale create eligibility or masquerade as a zero result', () => {
  const prior = { items: [], allowed_actions: ['create_draft'] };
  const loading = authoringEntryPresentation({ feature, list: prior, listState: 'loading' });
  const failed = authoringEntryPresentation({ feature, list: prior, listState: 'error' });
  const malformed = authoringEntryPresentation(ready({ allowed_actions: ['create_draft'] }));
  assert.equal(loading.kind, 'loading');
  for (const view of [loading, failed, malformed]) {
    assert.equal(view.canCreate, false);
    assert.equal(view.showSelector, false);
    assert.notEqual(view.kind, 'empty-create');
    assert.notEqual(view.kind, 'empty-no-create');
  }
  for (const view of [failed, malformed]) {
    assert.equal(view.kind, 'error');
    assert.match(view.description, /不能据此判断没有草稿或没有编制资格/);
    assert.match(view.description, /未保存输入保持/);
  }
});

test('visible existing drafts remain selectable without granting editing or file replacement', () => {
  const item = Object.freeze({ id: 'history-draft', process_name: '已有流程', revision_no: 7 });
  const list = Object.freeze({ items: Object.freeze([item]), allowed_actions: Object.freeze([]) });
  const view = authoringEntryPresentation(ready(list));
  assert.equal(view.kind, 'choose');
  assert.equal(view.showSelector, true);
  assert.equal(view.canCreate, false);
  assert.equal(view.canUpload, false);
  assert.match(view.description, /所选草稿实际提供的操作/);
  assert.equal(list.items[0], item);
});

test('explicit compilation rights on an opened existing draft permit upload independently of new-draft rights', () => {
  const workspace = { record: { id: 'existing-draft', case_id: 2 }, allowedActions: ['view', 'save'], attempt: null, submission: { purpose: '保留的本次材料' } };
  const before = fingerprint(workspace);
  const view = authoringEntryPresentation({ ...ready({ items: [], allowed_actions: [] }), workspace });
  assert.equal(view.kind, 'opened');
  assert.equal(view.canCreate, false);
  assert.equal(view.canUpload, true);
  assert.equal(fingerprint(workspace), before);
});

test('readonly, submission-only and unresolved request workspaces never promise file replacement', () => {
  const list = { items: [], allowed_actions: [] };
  for (const workspace of [
    { record: { id: 'readonly' }, allowedActions: ['view'] },
    { record: { id: 'submit-only' }, allowedActions: ['view', 'submit'] },
    { record: { id: 'uncertain' }, allowedActions: ['view', 'save'], attempt: { kind: 'save', uncertain: true } },
    { record: null, allowedActions: [], attempt: { kind: 'save' } }
  ]) {
    const before = fingerprint(workspace);
    assert.equal(authoringEntryPresentation({ ...ready(list), workspace }).canUpload, false);
    assert.equal(fingerprint(workspace), before);
  }
});

test('an opened new draft enables the existing upload path only while the feature is available', () => {
  const workspace = { record: null, allowedActions: [], attempt: null };
  assert.equal(authoringEntryPresentation({ ...ready({ items: [], allowed_actions: ['create_draft'] }), workspace }).canUpload, true);
  for (const unavailable of [null, { enabled: false, schema_ready: true }, { enabled: true, schema_ready: false }]) {
    const view = authoringEntryPresentation({ feature: unavailable, list: { items: [], allowed_actions: ['create_draft'] }, listState: 'ready', workspace });
    assert.equal(view.kind, 'unavailable');
    assert.equal(view.canCreate, false);
    assert.equal(view.canUpload, false);
  }
});
